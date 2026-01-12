/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as util from "util";
import * as cp from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import { GlobalConfig, ProjectConfig, ZephyrTask } from "../types";
import { ProjectConfigManager } from "../config";
import { QuickPickManager, DialogManager, OutputChannelManager, StatusBarManager } from "../ui";
import { TaskManager } from "../tasks";
import { installPythonDependencies } from "../environment";
import { platform, SettingsManager } from "../config";

export async function changeProjectCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  const output = OutputChannelManager.getChannel();
  output.clear();

  // Get the workspace root
  const rootPaths = vscode.workspace.workspaceFolders;
  if (!rootPaths) {
    return;
  }
  const rootPath = rootPaths[0].uri;

  const exec = util.promisify(cp.exec);

  // Get manifest path
  const cmd = "west config manifest.path";
  const result = await exec(cmd, { env: SettingsManager.buildEnvironmentForExecution(), cwd: rootPath.fsPath });
  
  if (result.stderr) {
    output.append(result.stderr);
    output.show();
    return;
  }

  // Find all CMakeLists.txt files with `project(` in them
  const projectList = await getProjectList(vscode.Uri.joinPath(rootPath, result.stdout.trim()));
  console.log("Available projects:", projectList);

  // Turn that into a project selection
  const selectedProject = await QuickPickManager.selectProject(projectList);
  
  if (selectedProject) {
    console.log("Changing project to " + selectedProject);
    vscode.window.showInformationMessage(`Project changed to ${selectedProject}`);
    project.target = selectedProject;

    // Clear conf and overlay files when switching projects
    project.extraConfFiles = [];
    project.extraOverlayFiles = [];

    await ProjectConfigManager.save(context, project);

    // Update status bars
    StatusBarManager.updateProjectStatusBar(project.target);
    StatusBarManager.updateExtraConfFilesStatusBar([]);
    StatusBarManager.updateExtraOverlayFilesStatusBar([]);
  }
}

export async function initRepoCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  dest: vscode.Uri
): Promise<void> {
  const output = OutputChannelManager.getChannel();
  output.show();

  // Load and update project configuration
  const project = await ProjectConfigManager.load(context);

  // Set isInitializing flag
  project.isInitializing = true;
  await ProjectConfigManager.save(context, project);
  
  // Schedule a delayed sidebar reveal to ensure it happens even if the immediate reveal doesn't work
  setTimeout(async () => {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.zephyr-tools');
    } catch (error) {
      // Silently fail if commands are not available
    }
  }, 2000);

  try {
    const taskName = "Zephyr Tools: Init Repo";

    // Get the root path of the workspace
    const rootPath = getRootPath();

    // Check if we're in the right workspace
    if (rootPath?.fsPath !== dest.fsPath) {
      console.log("Setting task!");

      // Reset isInitializing flag since we're switching workspaces
      project.isInitializing = false;
      await ProjectConfigManager.save(context, project);

      // Set init-repo task next
      const task: ZephyrTask = { name: "zephyr-tools.init-repo", data: dest };
      await ProjectConfigManager.savePendingTask(context, task);

      // Change workspace
      await vscode.commands.executeCommand("vscode.openFolder", dest);
      return;
    }

    // Set .vscode/settings.json
    const settings = {
      "git.enabled": false,
      "git.path": null,
      "git.autofetch": false,
    };

    // Make .vscode dir and settings.json
    await fs.mkdirp(path.join(dest.fsPath, ".vscode"));
    await fs.writeFile(path.join(dest.fsPath, ".vscode", "settings.json"), JSON.stringify(settings));

    // Options for Shell execution
    const shellOptions: vscode.ShellExecutionOptions = {
      env: <{ [key: string]: string }>SettingsManager.buildEnvironmentForExecution(),
      cwd: dest.fsPath,
    };

    // Check if .west is already here
    const exists = await fs.pathExists(path.join(dest.fsPath, ".west"));

    if (!exists) {
      // Get repository URL
      const url = await DialogManager.getRepositoryUrl();
      if (!url) {
        // Reset isInitializing flag on cancellation
        const project = await ProjectConfigManager.load(context);
        project.isInitializing = false;
        await ProjectConfigManager.save(context, project);
        
        vscode.window.showErrorMessage("Zephyr Tools: invalid repository url provided.");
        return;
      }

      // Ask for branch
      const branch = await DialogManager.getBranchName();

      // TODO: determine choices for west.yml
      const manifest = "west.yml";

      // git clone to destination
      let cmd = `west init -m ${url} --mf ${manifest}`;

      // Set branch option
      if (branch && branch !== "") {
        console.log(`Branch '${branch}'`);
        cmd = cmd + ` --mr ${branch}`;
      }

      const exec = new vscode.ShellExecution(cmd, shellOptions);

      // Task
      const task = new vscode.Task(
        { type: "zephyr-tools", command: taskName },
        vscode.TaskScope.Workspace,
        taskName,
        "zephyr-tools",
        exec,
      );

      // Start execution
      await TaskManager.push(task, { ignoreError: true, lastTask: false });
    }

    // `west update`
    const updateCmd = "west update";
    const updateExec = new vscode.ShellExecution(updateCmd, shellOptions);

    // Task
    const updateTask = new vscode.Task(
      { type: "zephyr-tools", command: taskName },
      vscode.TaskScope.Workspace,
      taskName,
      "zephyr-tools",
      updateExec,
    );

    // Callback to run after west update completes
    const westUpdateCallback = async (data: any) => {
      output.appendLine("[INIT] West update completed, determining zephyr base path...");

      // Get zephyr BASE
      let base = "zephyr";

      const exec = util.promisify(cp.exec);
      const cmd = "west list -f {path:28}";
      output.appendLine(`[INIT] Running: ${cmd}`);
      
      const result = await exec(cmd, { env: SettingsManager.buildEnvironmentForExecution(), cwd: dest.fsPath });
      if (result.stderr) {
        output.append(result.stderr);
        output.show();
      } else {
        result.stdout.split("\n").forEach((line: string) => {
          if (line.includes("zephyr")) {
            base = line.trim();
          }
        });
      }
      output.appendLine(`[INIT] Determined zephyr base path: ${base}`);

      // Install python dependencies
      const pythonenv = path.join(SettingsManager.getToolsDirectory(), "env");
      const venvPython = platform === "win32" 
        ? path.join(pythonenv, "Scripts", "python.exe") 
        : path.join(pythonenv, "bin", "python");
        
      const installCmd = `"${venvPython}" -m pip install -r ${path.join(base, "scripts", "requirements.txt")}`;
      output.appendLine(`[INIT] Starting pip install: ${installCmd}`);
      
      const installExec = new vscode.ShellExecution(installCmd, shellOptions);

      // Task
      const installTask = new vscode.Task(
        { type: "zephyr-tools", command: taskName },
        vscode.TaskScope.Workspace,
        taskName,
        "zephyr-tools",
        installExec,
      );

      // Final callback after pip install completes
      const done = async (data: any) => {
        // Set the isInit flag
        const project = await ProjectConfigManager.load(context);
        project.isInit = true;
        project.isInitializing = false;
        await ProjectConfigManager.save(context, project);
      };

      // Start execution
      await TaskManager.push(installTask, {
        ignoreError: false,
        lastTask: true,
        successMessage: "Init complete!",
        callback: done,
        callbackData: { dest: dest },
      });
    };

    // Start execution - west update with callback to run pip install after completion
    output.appendLine("[INIT] Starting west update...");
    await TaskManager.push(updateTask, {
      ignoreError: false,
      lastTask: false,
      callback: westUpdateCallback,
      callbackData: { dest: dest },
    });
  } catch (error) {
    // Reset isInitializing flag on error
    const project = await ProjectConfigManager.load(context);
    project.isInitializing = false;
    await ProjectConfigManager.save(context, project);

    let text = "";
    if (typeof error === "string") {
      text = error;
    } else if (error instanceof Error) {
      text = error.message;
    }

    output.append(text);
    vscode.window.showErrorMessage("Zephyr Tools: Init Repo error. See output for details.");
  }
}

async function getProjectList(folder: vscode.Uri): Promise<string[]> {
  const files = await vscode.workspace.fs.readDirectory(folder);
  const projects: string[] = [];

  const queue = [...files.map(([name, type]) => ({ name, type, path: folder }))];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file) break;

    if (file.name.includes("CMakeLists.txt")) {
      // Check the file content
      const filepath = vscode.Uri.joinPath(file.path, file.name);
      const contents = await vscode.workspace.openTextDocument(filepath).then(document => {
        return document.getText();
      });

      if (contents.includes("project(")) {
        const project = path.parse(filepath.fsPath);
        projects.push(project.dir);
      }
    } else if (file.name.includes("build") || file.name.includes(".git")) {
      // Skip these directories
    } else if (file.type === vscode.FileType.Directory) {
      const subPath = vscode.Uri.joinPath(file.path, file.name);
      const subfolders = await vscode.workspace.fs.readDirectory(subPath);
      
      for (const [subName, subType] of subfolders) {
        queue.push({
          name: path.join(file.name, subName),
          type: subType,
          path: file.path
        });
      }
    }
  }

  return projects;
}

function getRootPath(): vscode.Uri | undefined {
  if (vscode.workspace.workspaceFolders?.length ?? 0 > 0) {
    return vscode.workspace.workspaceFolders?.[0].uri;
  }
  return undefined;
}

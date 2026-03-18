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

  // Try to get manifest path (may fail if not in a west workspace)
  let projectList: string[] = [];
  try {
    const cmd = "west config manifest.path";
    const result = await exec(cmd, { env: SettingsManager.buildEnvironmentForExecution(), cwd: rootPath.fsPath });

    if (!result.stderr) {
      projectList = await getProjectList(vscode.Uri.joinPath(rootPath, result.stdout.trim()));
      console.log("Available projects:", projectList);
    }
  } catch (e) {
    // Not in a west workspace — browse option will still be available
    console.log("No west workspace detected, skipping manifest project scan");
  }

  // Turn that into a project selection (browse option is always included)
  const selectedProject = await QuickPickManager.selectProject(projectList);

  // Handle browse selection
  let resolvedProject: string | undefined = selectedProject;
  if (selectedProject === QuickPickManager.BROWSE_PROJECT_OPTION) {
    resolvedProject = await browseForProject();
  }

  if (resolvedProject) {
    console.log("Changing project to " + resolvedProject);
    vscode.window.showInformationMessage(`Project changed to ${resolvedProject}`);
    project.target = resolvedProject;

    // Clear conf, overlay files, and CMake defines when switching projects
    project.extraConfFiles = [];
    project.extraOverlayFiles = [];
    project.extraCMakeDefines = [];

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

        // Write marker file so activation can detect if venv was recreated
        try {
          const venvPath = path.join(SettingsManager.getToolsDirectory(), "env");
          fs.writeFileSync(path.join(venvPath, ".zephyr-init-complete"), new Date().toISOString());
        } catch {
          // Non-critical — marker is a best-effort optimization
        }
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

async function browseForProject(): Promise<string | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Select Project",
    title: "Select a Zephyr project directory",
  });

  if (!selected || selected.length === 0) {
    return undefined;
  }

  const projectDir = selected[0].fsPath;

  // Validate that the directory contains a CMakeLists.txt with project()
  const cmakePath = path.join(projectDir, "CMakeLists.txt");
  if (!await fs.pathExists(cmakePath)) {
    vscode.window.showErrorMessage("Selected directory does not contain a CMakeLists.txt file.");
    return undefined;
  }

  const contents = await fs.readFile(cmakePath, "utf-8");
  if (!contents.includes("project(")) {
    vscode.window.showErrorMessage("CMakeLists.txt does not contain a project() definition.");
    return undefined;
  }

  return projectDir;
}

function getRootPath(): vscode.Uri | undefined {
  if (vscode.workspace.workspaceFolders?.length ?? 0 > 0) {
    return vscode.workspace.workspaceFolders?.[0].uri;
  }
  return undefined;
}

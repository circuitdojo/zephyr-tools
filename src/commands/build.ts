/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import { GlobalConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { TaskManager } from "../tasks";
import { changeBoardCommand } from "./board-management";
import { changeProjectCommand } from "./project-management";
import { EnvironmentUtils } from "../utils";
import { SettingsManager } from "../config/settings-manager";
export async function buildCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  pristine: boolean = false,
  sidebarProvider?: any
): Promise<void> {
  // Validate setup state and manifest version
  const setupValidation = await ConfigValidator.validateSetupState(config, context, false);
  if (!setupValidation.isValid) {
    vscode.window.showErrorMessage(setupValidation.error!);
    return;
  }

  // Fetch the project config
  let project = await ProjectConfigManager.load(context);

  // Validate project initialization
  const projectValidation = ConfigValidator.validateProjectInit(project);
  if (!projectValidation.isValid) {
    vscode.window.showErrorMessage(projectValidation.error!);
    return;
  }

  // Build environment for execution using SettingsManager
  const env = SettingsManager.buildEnvironmentForExecution();

  // Auto-prompt for board if undefined (replicates old extension behavior)
  if (project.board === undefined) {
    await changeBoardCommand(config, context);
    
    // Reload project config after changeBoardCommand
    project = await ProjectConfigManager.load(context);
    
    // Check again - if still undefined, show error and return
    if (project.board === undefined) {
      vscode.window.showErrorMessage("You must choose a board to continue.");
      return;
    }
  }

  // Auto-prompt for project target if undefined (replicates old extension behavior)
  if (project.target === undefined) {
    await changeProjectCommand(config, context);
    
    // Reload project config after changeProjectCommand  
    project = await ProjectConfigManager.load(context);
    
    // Check again - if still undefined, show error and return
    if (project.target === undefined) {
      vscode.window.showErrorMessage("You must choose a project to build.");
      return;
    }
  }

  // Get the active workspace root path
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  }
  
  const rootPath = rootPaths[0].uri;

  // Options for Shell Execution with normalized environment
  let options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(env),
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Build";

  // Generate universal build path that works on windows & *nix
  let buildPath = path.join("build", project.board?.split("/")[0] ?? "");

  // Build command
  let cmd = `west build -b ${project.board}${pristine ? " -p" : ""} -d ${buildPath}${
    project.sysbuild ? " --sysbuild" : ""
  }`;

  // Add EXTRA_CONF_FILE parameter if extra conf files are selected
  if (project.extraConfFiles && project.extraConfFiles.length > 0) {
    const confFileList = project.extraConfFiles.join(';');
    cmd += ` -- -DEXTRA_CONF_FILE="${confFileList}"`;
  }

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Building for ${project.board}`);

  // Set up task completion listener to refresh sidebar
  let taskCompletionDisposable: vscode.Disposable | undefined;
  if (sidebarProvider) {
    taskCompletionDisposable = vscode.tasks.onDidEndTask((taskEvent) => {
      // Check if this is our build task that completed
      if (taskEvent.execution.task === task) {
        console.log('Build task completed, refreshing sidebar in 1 second...');
        // Small delay to ensure build artifacts are fully written
        setTimeout(() => {
          if (sidebarProvider && typeof sidebarProvider.refresh === 'function') {
            sidebarProvider.refresh();
          }
        }, 1000);
        
        // Clean up the listener
        taskCompletionDisposable?.dispose();
      }
    });
  }

  // Start execution
  await vscode.tasks.executeTask(task);
}

export async function buildPristineCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: any
): Promise<void> {
  await buildCommand(config, context, true, sidebarProvider);
}

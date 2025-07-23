/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";

export async function updateCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = ConfigValidator.validateSetupState(config);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }
  
  const project = await ProjectConfigManager.load(context);
  const rootPaths = vscode.workspace.workspaceFolders;
  
  if (!rootPaths) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }
  
  const options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: rootPaths[0].uri.fsPath,
  };
  
  const taskName = "Zephyr Tools: Update Dependencies";
  const cmd = "west update";
  const exec = new vscode.ShellExecution(cmd, options);
  
  const task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );
  
  try {
    await vscode.tasks.executeTask(task);
    vscode.window.showInformationMessage('Updating dependencies for project.');
  } catch (error) {
    vscode.window.showErrorMessage(`Update failed: ${error}`);
  }
}

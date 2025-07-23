/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig, ProjectConfig } from "../types";
import { ProjectConfigManager } from "../config";
import { SerialPortManager } from "../hardware";
import { TaskManager } from "../tasks";

export async function monitorCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command before monitoring.");
    return;
  }

  // Set port if necessary
  if (!project.port) {
    project.port = await SerialPortManager.selectPort(config);
    if (!project.port) {
      vscode.window.showErrorMessage("Error obtaining serial port.");
      return;
    }

    // Save settings
    await ProjectConfigManager.save(context, project);
  }

  // Options for Shell Execution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Serial Monitor";

  // Command to run
  let cmd = `zephyr-tools --port ${project.port} --follow --save`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  // Start execution
  await TaskManager.push(task, {
    ignoreError: false,
    lastTask: true,
    errorMessage: "Serial monitor error!",
  });
}

export async function setupMonitorCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  const project = await ProjectConfigManager.load(context);

  // Get serial settings
  const port = await SerialPortManager.selectPort(config);
  if (!port) {
    vscode.window.showErrorMessage("Error obtaining serial port.");
    return;
  }

  // Set port in project
  project.port = port;
  await ProjectConfigManager.save(context, project);

  // Message output
  vscode.window.showInformationMessage(`Serial monitor set to use ${project.port}`);
}

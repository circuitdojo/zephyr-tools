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
import { EnvironmentUtils } from "../utils";
import { SettingsManager } from "../config/settings-manager";

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

  // Options for Shell Execution with normalized environment
  let options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution()),
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Serial Monitor";

  // Command to run - conditionally include --save based on project setting
  const saveFlag = project.saveSerialLogs === true ? ' --save' : '';
  let cmd = `zephyr-tools --port ${project.port} --follow${saveFlag}`;
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

export async function toggleSerialLoggingCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  const project = await ProjectConfigManager.load(context);
  
  // Show dropdown with Enable/Disable options
  const currentStatus = project.saveSerialLogs ? 'Enabled' : 'Disabled';
  
  const loggingOptions = [
    {
      label: "Enable",
      description: "Save serial output to log files",
      value: true
    },
    {
      label: "Disable", 
      description: "Do not save serial output",
      value: false
    }
  ];

  const selectedOption = await vscode.window.showQuickPick(loggingOptions, {
    title: "Serial Logging Configuration",
    placeHolder: `Currently: ${currentStatus}`,
    ignoreFocusOut: true,
  });

  if (!selectedOption) {
    return; // User canceled
  }

  // Only update if the value changed
  if (project.saveSerialLogs !== selectedOption.value) {
    project.saveSerialLogs = selectedOption.value;
    await ProjectConfigManager.save(context, project);
    
    const status = project.saveSerialLogs ? 'enabled' : 'disabled';
    vscode.window.showInformationMessage(`Serial logging ${status}`);
  }
}

export async function changeSerialSettingsCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  const project = await ProjectConfigManager.load(context);

  // Show current settings
  const currentPort = project.port ? `Port: ${project.port}` : "No port configured";
  const loggingStatus = project.saveSerialLogs ? "Logging: Enabled" : "Logging: Disabled";

  // Options for what to change
  const changeOptions = [
    {
      label: "Change Serial Port",
      description: currentPort,
      action: "port"
    },
    {
      label: "Change Serial Logging",
      description: loggingStatus,
      action: "logging"
    },
    {
      label: "Configure Both",
      description: "Change port and logging settings",
      action: "both"
    }
  ];

  const selectedOption = await vscode.window.showQuickPick(changeOptions, {
    title: "Configure Serial Monitor Settings",
    placeHolder: "What would you like to change?",
    ignoreFocusOut: true,
  });

  if (!selectedOption) {
    return; // User canceled
  }

  switch (selectedOption.action) {
    case "port":
      await setupMonitorCommand(config, context);
      break;
    
    case "logging":
      await toggleSerialLoggingCommand(config, context);
      break;
    
    case "both":
      await setupMonitorCommand(config, context);
      await toggleSerialLoggingCommand(config, context);
      break;
  }
}

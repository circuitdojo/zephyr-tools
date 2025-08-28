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
  let port = SettingsManager.getSerialPort();
  if (!port) {
    port = await SerialPortManager.selectPort(config);
    if (!port) {
      vscode.window.showErrorMessage("Error obtaining serial port.");
      return;
    }

    // Save settings
    await SettingsManager.setSerialPort(port);
  }

  // Options for Shell Execution with normalized environment
  let options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution()),
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Serial Monitor";

  // Command to run - conditionally include --save based on setting
  const saveFlag = SettingsManager.getSerialSaveLogsToFile() ? ' --save' : '';
  let cmd = `zephyr-tools --port ${port} --follow${saveFlag}`;
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

  // Get serial settings
  const port = await SerialPortManager.selectPort(config);
  if (!port) {
    vscode.window.showErrorMessage("Error obtaining serial port.");
    return;
  }

  // Save to settings
  await SettingsManager.setSerialPort(port);

  // Message output
  vscode.window.showInformationMessage(`Serial monitor set to use ${port}`);
}

export async function toggleSerialLoggingCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  // Show dropdown with Enable/Disable options
  const currentStatus = SettingsManager.getSerialSaveLogsToFile() ? 'Enabled' : 'Disabled';
  
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
  const currentValue = SettingsManager.getSerialSaveLogsToFile();
  if (currentValue !== selectedOption.value) {
    await SettingsManager.setSerialSaveLogsToFile(selectedOption.value);
    
    const status = selectedOption.value ? 'enabled' : 'disabled';
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

  // Show current settings
  const currentPort = SettingsManager.getSerialPort();
  const currentPortDisplay = currentPort ? `Port: ${currentPort}` : "No port configured";
  const loggingStatus = SettingsManager.getSerialSaveLogsToFile() ? "Logging: Enabled" : "Logging: Disabled";

  // Options for what to change
  const changeOptions = [
    {
      label: "Change Serial Port",
      description: currentPortDisplay,
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

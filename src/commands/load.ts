/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { GlobalConfig, ProjectConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { SerialPortManager, NewtmgrManager } from "../hardware";
import { TaskManager } from "../tasks";
import { monitorCommand } from "./monitor";
import { PlatformUtils, EnvironmentUtils } from "../utils";
import { SettingsManager } from "../config/settings-manager";


export async function loadCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!project.board) {
    vscode.window.showErrorMessage("You must choose a board before loading.");
    return;
  }

  if (!project.target) {
    vscode.window.showErrorMessage("You must choose a project before loading.");
    return;
  }

  // Options for Shell Execution with normalized environment
  let options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution()),
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Load via Bootloader";

  // Get reduced device name
  const boardName = project.board.split("/")[0];
  console.log("boardName: " + boardName);

  // Track if we found a file
  let targetFile = "";

  // Check if build/boardName/dfu_application.zip_manifest.json exists
  const manifestPath = path.join(project.target, "build", boardName, "dfu_application.zip_manifest.json");
  const manifestExists = await fs.pathExists(manifestPath);

  if (manifestExists) {
    // Make sure zip file exists
    const dfuZip = path.join(project.target, "build", boardName, "dfu_application.zip");
    const dfuZipExists = await fs.pathExists(dfuZip);

    if (!dfuZipExists) {
      vscode.window.showWarningMessage(dfuZip + " not found!");
      return;
    }

    // Unzip dfu_application.zip
    const unzip = require('node-stream-zip');
    const zip = new unzip.async({ file: dfuZip });
    await zip.extract(null, path.join(project.target, "build", boardName));
    await zip.close();

    // Read the contents of the JSON file
    const content = fs.readFileSync(manifestPath).toString();
    const parsed = JSON.parse(content);

    // Get entry
    if (parsed.name === undefined) {
      vscode.window.showWarningMessage("Invalid manifest format.");
      return;
    }

    // Try to find the binary file - newer SDK uses .signed.bin, older uses .bin
    const signedBinary = path.join(project.target, "build", boardName, parsed.name + ".signed.bin");
    const regularBinary = path.join(project.target, "build", boardName, parsed.name + ".bin");

    if (await fs.pathExists(signedBinary)) {
      targetFile = signedBinary;
    } else if (await fs.pathExists(regularBinary)) {
      targetFile = regularBinary;
    } else {
      vscode.window.showWarningMessage(`Binary not found. Expected ${parsed.name}.signed.bin or ${parsed.name}.bin`);
      return;
    }
  } else {
    // Check if update file exists
    const files = ["app_update.bin", "zephyr.signed.bin"];

    for (const file of files) {
      // Get target path
      const targetPath = path.join(project.target, "build", boardName, "zephyr", file);

      // Check if file exists
      const exists = await fs.pathExists(targetPath);
      if (exists) {
        targetFile = targetPath;
        break;
      }
    }
  }

  // Don't proceed if nothing found
  if (targetFile === "") {
    vscode.window.showWarningMessage("Binary not found. Build project before loading.");
    return;
  }

  // Put device into BL mode automatically for Circuit Dojo Feather nRF9160
  if (boardName.includes("circuitdojo_feather_nrf9160")) {
    const tools = PlatformUtils.getToolExecutables();
    const blCmd = `${tools.zephyrTools} -b`;
    const blExec = new vscode.ShellExecution(blCmd, options);

    const blTask = new vscode.Task(
      { type: "zephyr-tools", command: "Zephyr Tools: Enter Bootloader" },
      vscode.TaskScope.Workspace,
      "Zephyr Tools: Enter Bootloader",
      "zephyr-tools",
      blExec,
    );

    // Start bootloader task and wait for completion using TaskManager
    await TaskManager.push(blTask, {
      ignoreError: false,
      lastTask: false,
      errorMessage: "Failed to enter bootloader mode",
    });
  }

  // Upload image using newtmgr connection profile
  const tools = PlatformUtils.getToolExecutables();
  const uploadCmd = `${tools.newtmgr} -c vscode-zephyr-tools image upload ${targetFile} -r 3 -t 0.25`;
  console.log("load command: " + uploadCmd);

  const uploadExec = new vscode.ShellExecution(uploadCmd, options);

  const uploadTask = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    uploadExec,
  );

  vscode.window.showInformationMessage(`Loading via bootloader for ${project.board}`);

  // Start upload task and wait for completion using TaskManager
  await TaskManager.push(uploadTask, {
    ignoreError: false,
    lastTask: false,
    errorMessage: "Load error! Did you init your project?",
    successMessage: "Load complete!",
  });

  // Small delay before reset (matching old implementation)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Reset device after upload
  const resetCmd = `${tools.newtmgr} -c vscode-zephyr-tools reset`;
  const resetExec = new vscode.ShellExecution(resetCmd, options);

  const resetTask = new vscode.Task(
    { type: "zephyr-tools", command: "Zephyr Tools: Reset Device" },
    vscode.TaskScope.Workspace,
    "Zephyr Tools: Reset Device",
    "zephyr-tools",
    resetExec,
  );

  // Start reset task and wait for completion using TaskManager
  await TaskManager.push(resetTask, {
    ignoreError: false,
    lastTask: true,
    errorMessage: "Reset error! Did you init your project?",
    successMessage: "Device reset!",
  });
}

export async function loadAndMonitorCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  try {
    // Step 1: Verify newtmgr connection exists
    if (!(await NewtmgrManager.verifyConnection(config))) {
      vscode.window.showErrorMessage("Run `Zephyr Tools: Setup Newtmgr` before loading.");
      return;
    }

    const project = await ProjectConfigManager.load(context);

    // Step 2: Load via bootloader
    await loadCommand(config, context);

    // Step 3: Set up serial port if not configured
    let port = SettingsManager.getSerialPort();
    if (!port) {
      port = await SerialPortManager.selectPort(config);
      if (!port) {
        vscode.window.showErrorMessage("Error obtaining serial port for monitoring.");
        return;
      }
      
      await SettingsManager.setSerialPort(port);
    }

    // Step 4: Start monitoring
    await monitorCommand(config, context);
    
  } catch (error) {
    vscode.window.showErrorMessage(`Load and monitor failed: ${error}`);
  }
}

export async function setupNewtmgrCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  try {
    // Check if newtmgr is installed
    if (!(await NewtmgrManager.isInstalled(config))) {
      vscode.window.showErrorMessage('newtmgr is not installed or not in PATH. Please install Apache Mynewt newtmgr tool.');
      return;
    }

    // Show current settings
    const currentPort = SettingsManager.getSerialPort();
    const currentBaud = SettingsManager.getNewtmgrBaudRate();
    const currentPortDisplay = currentPort ? `Port: ${currentPort}` : "No port configured";
    const currentBaudDisplay = `Baud: ${currentBaud}`;

    // Options for what to change
    const changeOptions = [
      {
        label: "Configure Port",
        description: currentPortDisplay,
        action: "port"
      },
      {
        label: "Configure Baud Rate",
        description: currentBaudDisplay,
        action: "baud"
      },
      {
        label: "Configure Both",
        description: "Set up port and baud rate",
        action: "both"
      },
      {
        label: "Test Connection",
        description: "Create newtmgr profile with current settings",
        action: "test"
      }
    ];

    const selectedOption = await vscode.window.showQuickPick(changeOptions, {
      title: "Configure Newtmgr Settings",
      placeHolder: "What would you like to do?",
      ignoreFocusOut: true,
    });

    if (!selectedOption) {
      return; // User canceled
    }

    let port = currentPort;
    let baudStr = currentBaud.toString();

    switch (selectedOption.action) {
      case "port":
        const newPort = await SerialPortManager.selectPort(config);
        if (newPort) {
          port = newPort;
          await SettingsManager.setSerialPort(port);
          vscode.window.showInformationMessage(`Serial port updated to: ${port}`);
        }
        break;
      
      case "baud":
        const newBaud = await vscode.window.showInputBox({
          prompt: "Enter baud rate",
          value: baudStr,
          placeHolder: baudStr,
          validateInput: (value) => {
            const num = parseInt(value);
            return isNaN(num) || num <= 0 ? "Please enter a valid baud rate" : null;
          }
        });
        if (newBaud) {
          baudStr = newBaud;
          await SettingsManager.setNewtmgrBaudRate(parseInt(newBaud));
          vscode.window.showInformationMessage(`Baud rate updated to: ${newBaud}`);
        }
        break;
      
      case "both":
        const newPortBoth = await SerialPortManager.selectPort(config);
        if (!newPortBoth) {
          return;
        }
        port = newPortBoth;
        
        const newBaudBoth = await vscode.window.showInputBox({
          prompt: "Enter baud rate",
          value: baudStr,
          placeHolder: baudStr,
          validateInput: (value) => {
            const num = parseInt(value);
            return isNaN(num) || num <= 0 ? "Please enter a valid baud rate" : null;
          }
        });
        if (!newBaudBoth) {
          return;
        }
        baudStr = newBaudBoth;
        
        // Save both settings
        await SettingsManager.setSerialPort(port);
        await SettingsManager.setNewtmgrBaudRate(parseInt(baudStr));
        vscode.window.showInformationMessage(`Newtmgr settings updated: ${port} @ ${baudStr} baud`);
        break;
      
      case "test":
        // Test with current settings
        break;
    }

    // If action was test or we just configured settings, create the connection profile
    if (selectedOption.action === "test" || selectedOption.action === "both") {
      if (!port) {
        vscode.window.showErrorMessage("No serial port configured. Please configure port first.");
        return;
      }

      // Create newtmgr connection profile
      const success = await NewtmgrManager.setupConnection(config, port, baudStr);
      if (success) {
        vscode.window.showInformationMessage("Newtmgr connection profile created successfully.");
      } else {
        vscode.window.showErrorMessage("Failed to create newtmgr connection profile.");
      }
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to configure newtmgr: ${error}`);
  }
}

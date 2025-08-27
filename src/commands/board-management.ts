/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { GlobalConfig, ProjectConfig } from "../types";
import { ProjectConfigManager } from "../config";
import { QuickPickManager, StatusBarManager } from "../ui";
import { YamlParser, EnvironmentUtils } from "../utils";
import { ProbeManager } from "../hardware";
import { SettingsManager } from "../config/settings-manager";

export async function changeBoardCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  // Get the workspace root
  const rootPaths = vscode.workspace.workspaceFolders;
  if (!rootPaths) {
    return;
  }
  const rootPath = rootPaths[0].uri;

  let boards: string[] = [];

  const files = await vscode.workspace.fs.readDirectory(rootPath);
  for (const [file, type] of files) {
    if (type === vscode.FileType.Directory) {
      // Ignore folders that begin with .
      if (file.startsWith(".")) {
        continue;
      }

      // Get boards
      const boardsDir = vscode.Uri.joinPath(rootPath, `${file}/boards`);

      // Only check if path exists
      if (fs.pathExistsSync(boardsDir.fsPath)) {
        console.log("Searching boards dir: " + boardsDir.fsPath);
        boards = boards.concat(await getBoardList(boardsDir));
      }
    }
  }

  // Prompt which board to use
  const selectedBoard = await QuickPickManager.selectBoard(boards);

  if (selectedBoard) {
    console.log("Changing board to " + selectedBoard);
    vscode.window.showInformationMessage(`Board changed to ${selectedBoard}`);
    project.board = selectedBoard;
    await ProjectConfigManager.save(context, project);
    
    // Update status bar
    StatusBarManager.updateBoardStatusBar(project.board);
  }
}

async function getBoardList(folder: vscode.Uri): Promise<string[]> {
  const result: string[] = [];
  const foldersToIgnore = ["build", ".git", "bindings"];

  const folderQueue: string[] = [folder.fsPath];

  while (folderQueue.length > 0) {
    const currentFolder = folderQueue.shift() as string;

    // Check if board.yml exists in currentFolder
    const boardYamlPath = path.join(currentFolder, "board.yml");
    if (fs.existsSync(boardYamlPath)) {
      const boards = await YamlParser.parseBoardYaml(boardYamlPath);
      result.push(...boards);
      continue;
    }

    // If board.yml isn't found we'll have to do a deeper search
    const entries = fs.readdirSync(currentFolder, { withFileTypes: true });

    // Iterate over all entries
    for (const entry of entries) {
      if (entry.isDirectory() && !foldersToIgnore.includes(entry.name)) {
        folderQueue.push(path.join(currentFolder, entry.name));
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".yaml")) {
          const filePath = path.join(currentFolder, entry.name);

          // Remove .yaml from name
          const name = path.parse(filePath).name;

          // Add name to result
          result.push(name);
        }
      }
    }
  }

  return result;
}

export async function changeRunnerCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  // Get the workspace root
  const rootPaths = vscode.workspace.workspaceFolders;
  if (!rootPaths) {
    return;
  }
  const rootPath = rootPaths[0].uri;

  let runners: string[] = ["default"];

  // Get runners from $rootPath/zephyr/boards/common (correct runner names)
  const runnersDir = path.join(rootPath.fsPath, "zephyr", "boards", "common");

  try {
    const files = fs.readdirSync(runnersDir);
    const r = files
      .filter(file => file.endsWith(".board.cmake"))
      .map(file => file.replace(".board.cmake", ""))
      .sort();
    console.log("Available runners:", r);

    runners.push(...r);
    vscode.window.showInformationMessage(`Runners: ${runners.join(", ")}`);
  } catch (err) {
    if (err instanceof Error) {
      vscode.window.showErrorMessage(`Error reading runners directory: ${err.message}`);
    } else {
      vscode.window.showErrorMessage("An unknown error occurred while reading the runners directory.");
    }
  }

  console.log("Runners: " + runners);

  // Prompt which runner to use
  const selectedRunner = await QuickPickManager.selectRunner(runners);

  const runnerArgs = await vscode.window.showInputBox({
    placeHolder: "Enter runner args..",
    ignoreFocusOut: true,
  });

  if (selectedRunner) {
    let args = "";
    // Check to make sure args are not undefined
    if (runnerArgs) {
      args = " with args: " + runnerArgs;
      project.runnerParams = runnerArgs;
    } else {
      project.runnerParams = undefined;
    }

    console.log("Changing runner to " + selectedRunner + args);
    vscode.window.showInformationMessage(`Runner changed to ${selectedRunner}${args}`);

    if (selectedRunner === "default") {
      project.runner = undefined;
    } else {
      project.runner = selectedRunner;
    }
    await ProjectConfigManager.save(context, project);
  }
}

export async function changeProbeRsSettingsCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  // Get current settings from SettingsManager
  const currentProbe = SettingsManager.getProbeRsProbeId();
  const currentChip = SettingsManager.getProbeRsChipName();
  const preverify = SettingsManager.getProbeRsPreverify();
  const verify = SettingsManager.getProbeRsVerify();
  
  // Show current settings
  const currentProbeDisplay = currentProbe ? `Probe ID: ${currentProbe}` : "No probe configured";
  const currentChipDisplay = currentChip ? `Chip: ${currentChip}` : "No chip configured";
  const verifyDisplay = `Preverify: ${preverify ? "✓" : "✗"}, Verify: ${verify ? "✓" : "✗"}`;
  
  // Options for what to change
  const changeOptions = [
    {
      label: "Change Probe",
      description: currentProbeDisplay,
      action: "probe"
    },
    {
      label: "Change Chip Name", 
      description: currentChipDisplay,
      action: "chip"
    },
    {
      label: "Configure Verification",
      description: verifyDisplay,
      action: "verify"
    },
    {
      label: "Change All Settings",
      description: "Reconfigure probe, chip, and verification",
      action: "all"
    },
    {
      label: "Clear All Settings",
      description: "Remove all probe-rs configuration",
      action: "clear"
    }
  ];

  const selectedOption = await vscode.window.showQuickPick(changeOptions, {
    title: "Configure probe-rs Settings",
    placeHolder: "What would you like to change?",
    ignoreFocusOut: true,
  });

  if (!selectedOption) {
    return; // User canceled
  }

  switch (selectedOption.action) {
    case "probe":
      await changeProbeSelection(config);
      break;
    case "chip":
      await changeChipSelection(config);
      break;
    case "verify":
      await changeVerificationSettings();
      break;
    case "all":
      await changeProbeSelection(config);
      await changeChipSelection(config);
      await changeVerificationSettings();
      break;
    case "clear":
      await clearProbeRsSettings();
      break;
  }
}

// Change probe selection
async function changeProbeSelection(config: GlobalConfig) {
  // Use normalized environment from config
  const normalizedEnv = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
  const availableProbes = await ProbeManager.getAvailableProbes(normalizedEnv);
  if (!availableProbes || availableProbes.length === 0) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return;
  }

  const selectedProbe = await ProbeManager.selectProbe(availableProbes);
  if (!selectedProbe) {
    vscode.window.showWarningMessage("No probe selected. Probe configuration unchanged.");
    return;
  }

  // Update settings
  if (selectedProbe.probeId) {
    await SettingsManager.setProbeRsProbeId(selectedProbe.probeId);
    const probeInfo = `(ID: ${selectedProbe.probeId})`;
    vscode.window.showInformationMessage(`Probe updated to: ${selectedProbe.name} ${probeInfo}`);
  }
}

// Change chip selection
async function changeChipSelection(config: GlobalConfig) {
  // Use normalized environment from config
  const normalizedEnv = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
  const chipName = await ProbeManager.getProbeRsChipName(normalizedEnv);
  if (!chipName) {
    vscode.window.showWarningMessage("No chip selected. Chip configuration unchanged.");
    return;
  }

  // Update settings
  await SettingsManager.setProbeRsChipName(chipName);
  vscode.window.showInformationMessage(`Chip name updated to: ${chipName}`);
}

// Change verification settings
async function changeVerificationSettings() {
  const currentPreverify = SettingsManager.getProbeRsPreverify();
  const currentVerify = SettingsManager.getProbeRsVerify();
  
  const verifyOptions = [
    {
      label: "Enable Preverify",
      description: "Verify memory before flashing",
      picked: currentPreverify,
      setting: "preverify"
    },
    {
      label: "Enable Verify",
      description: "Verify memory after flashing",
      picked: currentVerify,
      setting: "verify"
    }
  ];

  const selectedOptions = await vscode.window.showQuickPick(verifyOptions, {
    title: "Configure Verification Settings",
    placeHolder: "Select options to toggle (current state shown)",
    canPickMany: true,
    ignoreFocusOut: true,
  });

  if (!selectedOptions) {
    return; // User canceled
  }

  // Determine new states
  const newPreverify = selectedOptions.some(opt => opt.setting === "preverify");
  const newVerify = selectedOptions.some(opt => opt.setting === "verify");

  // Update settings
  await SettingsManager.setProbeRsPreverify(newPreverify);
  await SettingsManager.setProbeRsVerify(newVerify);

  vscode.window.showInformationMessage(
    `Verification settings updated: Preverify=${newPreverify ? "enabled" : "disabled"}, Verify=${newVerify ? "enabled" : "disabled"}`
  );
}

// Clear all probe-rs settings
async function clearProbeRsSettings() {
  const hadSettings = SettingsManager.getProbeRsProbeId() || SettingsManager.getProbeRsChipName() || 
                     SettingsManager.getProbeRsPreverify() || SettingsManager.getProbeRsVerify();
  
  // Clear all settings
  await SettingsManager.setProbeRsProbeId("");
  await SettingsManager.setProbeRsChipName("");
  await SettingsManager.setProbeRsPreverify(false);
  await SettingsManager.setProbeRsVerify(false);
  
  if (hadSettings) {
    vscode.window.showInformationMessage("probe-rs settings cleared. Next flash will prompt for probe and chip selection.");
  } else {
    vscode.window.showInformationMessage("No probe-rs settings were configured.");
  }
}

export async function changeSysBuildCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  // Yes to enable, no to disable popup
  const result = await vscode.window.showQuickPick(["Yes", "No"], {
    placeHolder: "Enable sysbuild?",
    ignoreFocusOut: true,
  });

  if (result) {
    if (result === "Yes") {
      project.sysbuild = true;
    } else {
      project.sysbuild = false;
    }
    await ProjectConfigManager.save(context, project);
    vscode.window.showInformationMessage(`Sysbuild ${result === "Yes" ? "enabled" : "disabled"}`);
  }
}

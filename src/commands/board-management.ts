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
  let project = await ProjectConfigManager.load(context);

  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  // Show current settings
  const currentProbe = project.probeRsProbeId ? `Probe ID: ${project.probeRsProbeId}` : "No probe configured";
  const currentChip = project.probeRsChipName ? `Chip: ${project.probeRsChipName}` : "No chip configured";
  
  // Options for what to change
  const changeOptions = [
    {
      label: "Change Probe",
      description: currentProbe,
      action: "probe"
    },
    {
      label: "Change Chip Name", 
      description: currentChip,
      action: "chip"
    },
    {
      label: "Change Both",
      description: "Reconfigure probe and chip",
      action: "both"
    },
    {
      label: "Clear All Settings",
      description: "Remove cached probe-rs configuration",
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
      await changeProbeSelection(config, project, context);
      break;
    case "chip":
      await changeChipSelection(config, project, context);
      break;
    case "both":
      await changeProbeSelection(config, project, context);
      // Reload project config in case it was updated
      project = await ProjectConfigManager.load(context);
      await changeChipSelection(config, project, context);
      break;
    case "clear":
      await clearProbeRsSettings(project, context);
      break;
  }
}

// Change probe selection
async function changeProbeSelection(config: GlobalConfig, project: ProjectConfig, context: vscode.ExtensionContext) {
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

  // Update project config
  project.probeRsProbeId = selectedProbe.probeId;
  await ProjectConfigManager.save(context, project);
  
  const probeInfo = selectedProbe.probeId ? `(ID: ${selectedProbe.probeId})` : "";
  vscode.window.showInformationMessage(`Probe updated to: ${selectedProbe.name} ${probeInfo}`);
}

// Change chip selection
async function changeChipSelection(config: GlobalConfig, project: ProjectConfig, context: vscode.ExtensionContext) {
  // Use normalized environment from config
  const normalizedEnv = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
  const chipName = await ProbeManager.getProbeRsChipName(normalizedEnv);
  if (!chipName) {
    vscode.window.showWarningMessage("No chip selected. Chip configuration unchanged.");
    return;
  }

  // Update project config  
  project.probeRsChipName = chipName;
  await ProjectConfigManager.save(context, project);
  
  vscode.window.showInformationMessage(`Chip name updated to: ${chipName}`);
}

// Clear all probe-rs settings
async function clearProbeRsSettings(project: ProjectConfig, context: vscode.ExtensionContext) {
  const hadSettings = project.probeRsProbeId || project.probeRsChipName;
  
  project.probeRsProbeId = undefined;
  project.probeRsChipName = undefined;
  await ProjectConfigManager.save(context, project);
  
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

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import { GlobalConfig, ProjectConfig, BuildConfigSnapshot } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { ProjectOverridesManager, ProjectOverrides } from "../config/project-overrides";
import { TaskManager, TaskManagerTaskOptions } from "../tasks";
import { changeBoardCommand, discoverBoards } from "./board-management";
import { changeProjectCommand } from "./project-management";
import { EnvironmentUtils, readCMakeCache } from "../utils";
import { SettingsManager } from "../config/settings-manager";
import { QuickPickManager } from "../ui";

/**
 * Build a single board. Core reusable function used by both single and multi-build commands.
 * Does NOT modify the active ProjectConfig — constructs a synthetic config from the provided board + overrides.
 */
export async function buildForBoard(
  context: vscode.ExtensionContext,
  board: string,
  projectTarget: string,
  overrides: ProjectOverrides,
  pristine: boolean,
  sidebarProvider?: any,
  taskOptions?: Partial<TaskManagerTaskOptions>
): Promise<void> {
  // Construct synthetic project config without modifying workspace state
  const project: ProjectConfig = {
    isInit: true,
    board,
    target: projectTarget,
    sysbuild: overrides.sysbuild,
    extraConfFiles: overrides.extraConfFiles,
    extraOverlayFiles: overrides.extraOverlayFiles,
    extraCMakeDefines: overrides.extraCMakeDefines,
  };

  const env = SettingsManager.buildEnvironmentForExecution();

  let options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(env),
    cwd: projectTarget,
  };

  const boardBase = board.split("/")[0] ?? "";
  const taskName = `Zephyr Tools: Build (${boardBase})`;
  const buildPath = path.join("build", boardBase);

  // Smart reconfiguration detection
  const cacheDir = path.join(projectTarget, buildPath);
  const cache = await readCMakeCache(cacheDir);
  const currentSnapshot = createSnapshot(project);
  const storedSnapshot = await ProjectConfigManager.loadBuildSnapshot(context, buildPath);

  let cmd: string;
  if (pristine || !cache) {
    cmd = buildFullCommand(project, buildPath, pristine);
  } else if (configHasAdditionsOrChanges(project, cache)) {
    cmd = buildFullCommand(project, buildPath, false);
  } else if (storedSnapshot && snapshotHasRemovals(currentSnapshot, storedSnapshot)) {
    cmd = buildFullCommand(project, buildPath, true);
  } else {
    cmd = `west build -d ${buildPath}`;
  }

  let exec = new vscode.ShellExecution(cmd, options);

  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName, board },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  // Save snapshot before build
  await ProjectConfigManager.saveBuildSnapshot(context, buildPath, currentSnapshot);

  // Set up task completion listener to refresh sidebar
  if (sidebarProvider) {
    const processDisposable = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task === task) {
        setTimeout(() => {
          if (typeof sidebarProvider.refresh === 'function') {
            sidebarProvider.refresh();
          }
        }, 1000);
        processDisposable.dispose();
      }
    });
  }

  await TaskManager.push(task, {
    ignoreError: taskOptions?.ignoreError ?? false,
    lastTask: taskOptions?.lastTask ?? true,
    errorMessage: taskOptions?.errorMessage,
    successMessage: taskOptions?.successMessage,
    callback: taskOptions?.callback,
    callbackData: taskOptions?.callbackData,
  });
}

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

  // Auto-prompt for board if undefined
  if (project.board === undefined) {
    await changeBoardCommand(config, context);
    project = await ProjectConfigManager.load(context);
    if (project.board === undefined) {
      vscode.window.showErrorMessage("You must choose a board to continue.");
      return;
    }
  }

  // Auto-prompt for project target if undefined
  if (project.target === undefined) {
    await changeProjectCommand(config, context);
    project = await ProjectConfigManager.load(context);
    if (project.target === undefined) {
      vscode.window.showErrorMessage("You must choose a project to build.");
      return;
    }
  }

  vscode.window.showInformationMessage(`Building for ${project.board}`);

  const overrides = ProjectOverridesManager.extractOverrides(project);
  await buildForBoard(context, project.board!, project.target!, overrides, pristine, sidebarProvider);
}

/**
 * Extract a build config snapshot from the current project config.
 */
function createSnapshot(project: ProjectConfig): BuildConfigSnapshot {
  return {
    board: project.board ?? "",
    sysbuild: project.sysbuild ?? false,
    extraConfFiles: [...(project.extraConfFiles ?? [])],
    extraOverlayFiles: [...(project.extraOverlayFiles ?? [])],
    extraCMakeDefines: [...(project.extraCMakeDefines ?? [])],
  };
}

/**
 * Check if current config has new or changed values vs CMakeCache.txt.
 * Handles additions and value changes (not removals).
 */
function configHasAdditionsOrChanges(project: ProjectConfig, cache: Map<string, string>): boolean {
  // Check board
  if ((project.board ?? "") !== (cache.get("BOARD") ?? "")) {
    return true;
  }

  // Check extra conf files
  const confFiles = project.extraConfFiles?.length ? project.extraConfFiles.join(";") : "";
  if (confFiles !== (cache.get("EXTRA_CONF_FILE") ?? "")) {
    return true;
  }

  // Check extra overlay files
  const overlayFiles = project.extraOverlayFiles?.length ? project.extraOverlayFiles.join(";") : "";
  if (overlayFiles !== (cache.get("DTC_OVERLAY_FILE") ?? "")) {
    return true;
  }

  // Check custom CMake defines — CMake may store under original key or CLI_ prefix
  if (project.extraCMakeDefines?.length) {
    for (const define of project.extraCMakeDefines) {
      const eqIndex = define.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }
      const key = define.substring(0, eqIndex);
      const value = define.substring(eqIndex + 1);
      const cached = cache.get(key) ?? cache.get(`CLI_${key}`);
      if ((cached ?? "") !== value) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if items were removed from the current config vs the stored snapshot.
 * Removals require a pristine build to clear stale CMakeCache entries.
 */
function snapshotHasRemovals(current: BuildConfigSnapshot, previous: BuildConfigSnapshot): boolean {
  // Check if any conf files were removed
  if (current.extraConfFiles.length < previous.extraConfFiles.length) {
    return true;
  }
  // Check if specific conf files were removed (not just count)
  const currentConf = new Set(current.extraConfFiles);
  if (previous.extraConfFiles.some(f => !currentConf.has(f))) {
    return true;
  }

  // Check if any overlay files were removed
  const currentOverlay = new Set(current.extraOverlayFiles);
  if (previous.extraOverlayFiles.some(f => !currentOverlay.has(f))) {
    return true;
  }

  // Check if any CMake defines were removed (compare by key)
  const currentKeys = new Set(current.extraCMakeDefines.map(d => d.split("=")[0]));
  const previousKeys = previous.extraCMakeDefines.map(d => d.split("=")[0]);
  if (previousKeys.some(k => !currentKeys.has(k))) {
    return true;
  }

  return false;
}

/**
 * Build the full west build command with all flags and -D defines.
 */
function buildFullCommand(project: ProjectConfig, buildPath: string, pristine: boolean): string {
  let cmd = `west build -b ${project.board}${pristine ? " -p" : ""} -d ${buildPath}${
    project.sysbuild ? " --sysbuild" : ""
  }`;

  const hasExtraConfFiles = project.extraConfFiles && project.extraConfFiles.length > 0;
  const hasExtraOverlayFiles = project.extraOverlayFiles && project.extraOverlayFiles.length > 0;
  const hasCustomDefines = project.extraCMakeDefines && project.extraCMakeDefines.length > 0;

  if (hasExtraConfFiles || hasExtraOverlayFiles || hasCustomDefines) {
    cmd += ' --';

    if (hasExtraConfFiles) {
      const confFileList = project.extraConfFiles!.join(';');
      cmd += ` -DEXTRA_CONF_FILE="${confFileList}"`;
    }

    if (hasExtraOverlayFiles) {
      const overlayFileList = project.extraOverlayFiles!.join(';');
      cmd += ` -DDTC_OVERLAY_FILE="${overlayFileList}"`;
    }

    if (hasCustomDefines) {
      for (const define of project.extraCMakeDefines!) {
        cmd += ` -D${define.replace(/"/g, '\\"')}`;
      }
    }
  }

  return cmd;
}

export async function buildPristineCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: any
): Promise<void> {
  await buildCommand(config, context, true, sidebarProvider);
}

const ADD_BOARD_LABEL = "$(add) Add board...";

/**
 * Build the QuickPick items list from override boards.
 */
function buildBoardPickItems(overrideBoards: string[]): vscode.QuickPickItem[] {
  const items: vscode.QuickPickItem[] = [
    { label: ADD_BOARD_LABEL, alwaysShow: true },
  ];
  for (const board of overrideBoards) {
    items.push({ label: board });
  }
  return items;
}

/**
 * Show a multi-select quick pick of boards from overrides, with an option to add new boards.
 * "Add board..." immediately opens the board discovery picker when selected.
 * Returns the list of selected board names, or undefined if cancelled.
 */
async function showBoardMultiPick(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  projectTarget: string
): Promise<string[] | undefined> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const overrideBoards = await ProjectOverridesManager.getBoards(projectTarget);
    const result = await showBoardPickerWithAddOption(context, projectTarget, overrideBoards);

    if (result === "add-board") {
      // User triggered "Add board..." — loop back to re-show with updated list
      continue;
    }

    return result;
  }
}

/**
 * Shows the multi-select board picker using createQuickPick API.
 * Returns selected board labels, undefined if cancelled, or "add-board" if the user
 * triggered the add board flow (board was already added to overrides).
 */
function showBoardPickerWithAddOption(
  context: vscode.ExtensionContext,
  projectTarget: string,
  overrideBoards: string[]
): Promise<string[] | "add-board" | undefined> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick();
    picker.canSelectMany = true;
    picker.placeholder = overrideBoards.length > 0
      ? "Select boards to build (all selected by default)"
      : "No boards configured yet — select 'Add board...' to get started";
    picker.ignoreFocusOut = true;
    picker.matchOnDescription = true;

    const items = buildBoardPickItems(overrideBoards);
    picker.items = items;

    // Pre-select all board items (not the "Add board..." item)
    picker.selectedItems = items.filter(i => i.label !== ADD_BOARD_LABEL);

    let resolved = false;

    picker.onDidChangeSelection(async (selected) => {
      const addSelected = selected.some(s => s.label === ADD_BOARD_LABEL);
      if (addSelected && !resolved) {
        resolved = true;
        picker.hide();

        // Show board discovery picker immediately
        const { boards, recentCount } = await discoverBoards(projectTarget);
        const newBoard = await QuickPickManager.selectBoard(boards, recentCount);

        if (newBoard && !overrideBoards.includes(newBoard)) {
          const project = await ProjectConfigManager.load(context);
          await ProjectOverridesManager.save(projectTarget, newBoard, {
            ...project,
            board: newBoard,
          });
        }

        resolve("add-board");
      }
    });

    picker.onDidAccept(async () => {
      if (resolved) {
        return;
      }
      resolved = true;

      const selectedBoards = picker.selectedItems
        .filter(s => s.label !== ADD_BOARD_LABEL)
        .map(s => s.label);

      picker.hide();

      // Remove deselected boards from overrides
      const deselected = overrideBoards.filter(b => !selectedBoards.includes(b));
      for (const board of deselected) {
        await ProjectOverridesManager.remove(projectTarget, board);
      }

      if (selectedBoards.length === 0) {
        vscode.window.showWarningMessage("No boards selected.");
        resolve(undefined);
      } else {
        resolve(selectedBoards);
      }
    });

    picker.onDidHide(() => {
      if (!resolved) {
        resolve(undefined);
      }
      picker.dispose();
    });

    picker.show();
  });
}

/**
 * Build for multiple selected boards sequentially.
 */
export async function buildMultiCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  pristine: boolean = false,
  sidebarProvider?: any
): Promise<void> {
  const setupValidation = await ConfigValidator.validateSetupState(config, context, false);
  if (!setupValidation.isValid) {
    vscode.window.showErrorMessage(setupValidation.error!);
    return;
  }

  let project = await ProjectConfigManager.load(context);

  const projectValidation = ConfigValidator.validateProjectInit(project);
  if (!projectValidation.isValid) {
    vscode.window.showErrorMessage(projectValidation.error!);
    return;
  }

  // Auto-prompt for project target if undefined
  if (project.target === undefined) {
    await changeProjectCommand(config, context);
    project = await ProjectConfigManager.load(context);
    if (project.target === undefined) {
      vscode.window.showErrorMessage("You must choose a project to build.");
      return;
    }
  }

  const selectedBoards = await showBoardMultiPick(config, context, project.target!);
  if (!selectedBoards) {
    return;
  }

  await buildBoards(context, project.target!, selectedBoards, pristine, sidebarProvider);
}

/**
 * Build all boards that have saved overrides.
 */
export async function buildAllCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  pristine: boolean = false,
  sidebarProvider?: any
): Promise<void> {
  const setupValidation = await ConfigValidator.validateSetupState(config, context, false);
  if (!setupValidation.isValid) {
    vscode.window.showErrorMessage(setupValidation.error!);
    return;
  }

  let project = await ProjectConfigManager.load(context);

  const projectValidation = ConfigValidator.validateProjectInit(project);
  if (!projectValidation.isValid) {
    vscode.window.showErrorMessage(projectValidation.error!);
    return;
  }

  if (project.target === undefined) {
    await changeProjectCommand(config, context);
    project = await ProjectConfigManager.load(context);
    if (project.target === undefined) {
      vscode.window.showErrorMessage("You must choose a project to build.");
      return;
    }
  }

  const boards = await ProjectOverridesManager.getBoards(project.target!);
  if (boards.length === 0) {
    vscode.window.showErrorMessage(
      "No board configurations saved. Use 'Zephyr Tools: Build Multiple Boards' to set up boards first."
    );
    return;
  }

  await buildBoards(context, project.target!, boards, pristine, sidebarProvider);
}

/**
 * Build a list of boards sequentially via the TaskManager queue.
 */
async function buildBoards(
  context: vscode.ExtensionContext,
  projectTarget: string,
  boards: string[],
  pristine: boolean,
  sidebarProvider?: any
): Promise<void> {
  const boardNames = boards.map(b => b.split("/")[0]).join(", ");
  vscode.window.showInformationMessage(`Building for ${boards.length} board(s): ${boardNames}`);

  for (let i = 0; i < boards.length; i++) {
    const board = boards[i];
    const isLast = i === boards.length - 1;
    const overrides = await ProjectOverridesManager.load(projectTarget, board) ?? {
      sysbuild: true,
    };

    await buildForBoard(context, board, projectTarget, overrides, pristine, sidebarProvider, {
      ignoreError: true,
      lastTask: isLast,
      successMessage: isLast ? `Multi-build complete: ${boards.length} board(s)` : undefined,
    });
  }
}

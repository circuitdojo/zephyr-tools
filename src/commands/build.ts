/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import { GlobalConfig, ProjectConfig, BuildConfigSnapshot } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { TaskManager } from "../tasks";
import { changeBoardCommand } from "./board-management";
import { changeProjectCommand } from "./project-management";
import { EnvironmentUtils, readCMakeCache } from "../utils";
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

  // Determine if reconfiguration is needed using hybrid detection:
  // - CMakeCache.txt detects additions/changes (robust to out-of-band builds)
  // - Workspace state snapshot detects removals (only way to clear stale cache)
  const cacheDir = path.join(project.target!, buildPath);
  const cache = await readCMakeCache(cacheDir);
  const currentSnapshot = createSnapshot(project);
  const storedSnapshot = await ProjectConfigManager.loadBuildSnapshot(context, buildPath);

  let cmd: string;
  if (pristine || !cache) {
    // Pristine requested or first build (no CMakeCache.txt)
    cmd = buildFullCommand(project, buildPath, pristine);
  } else if (configHasAdditionsOrChanges(project, cache)) {
    // Values added or changed — pass full flags, no pristine needed
    cmd = buildFullCommand(project, buildPath, false);
  } else if (storedSnapshot && snapshotHasRemovals(currentSnapshot, storedSnapshot)) {
    // Values removed — must pristine to clear stale cache entries
    cmd = buildFullCommand(project, buildPath, true);
  } else {
    // Nothing changed — true incremental build
    cmd = `west build -d ${buildPath}`;
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

  // Save snapshot before build so removal detection works even if the build fails
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

  // Start execution
  await vscode.tasks.executeTask(task);
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

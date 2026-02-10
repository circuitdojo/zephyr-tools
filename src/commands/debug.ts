/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { GlobalConfig } from "../types";
import { ProjectConfigManager } from "../config";
import { SettingsManager } from "../config/settings-manager";
import { ProbeManager } from "../hardware";
import { EnvironmentUtils } from "../utils";

/**
 * Create or update a probe-rs debug configuration in launch.json based on current project.
 */
export async function createDebugConfigurationCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check for probe-rs debugger extension availability and offer install/enable guidance
  await ensureProbeRsDebuggerInstalled();
  // Validate workspace
  const rootFolders = vscode.workspace.workspaceFolders;
  if (!rootFolders || rootFolders.length === 0) {
    vscode.window.showErrorMessage("Open a workspace to create a debug configuration.");
    return;
  }
  const workspaceUri = rootFolders[0].uri;

  // Load project configuration
  let project = await ProjectConfigManager.load(context);
  if (!project.board || !project.target) {
    vscode.window.showErrorMessage("Select a board and project before creating a debug configuration.");
    return;
  }

  // Resolve chip name (from settings or prompt via probe-rs)
  let chipName: string | undefined = SettingsManager.getProbeRsChipName();
  if (!chipName) {
    const env = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
    chipName = await ProbeManager.getProbeRsChipName(env);
    if (!chipName) {
      vscode.window.showWarningMessage("Chip name not selected. Debug configuration not created.");
      return;
    }
    await SettingsManager.setProbeRsChipName(chipName);
  }

  // Derive build directory and candidate ELF paths
  const boardBase = project.board.split("/")[0];
  const buildDir = path.join(project.target, "build", boardBase);

  const candidates: Array<{ key: string; fullPath: string }> = [
    { key: "app", fullPath: path.join(buildDir, "app", "zephyr", "zephyr.elf") },
    { key: "default", fullPath: path.join(buildDir, "zephyr", "zephyr.elf") },
    { key: "tfm", fullPath: path.join(buildDir, "tfm", "zephyr", "zephyr.elf") },
    { key: "spm", fullPath: path.join(buildDir, "spm", "zephyr", "zephyr.elf") },
    { key: "mcuboot", fullPath: path.join(buildDir, "mcuboot", "zephyr", "zephyr.elf") },
  ];

  // Also scan direct children of buildDir for <name>/zephyr/zephyr.elf
  try {
    const children = await fs.readdir(buildDir);
    for (const child of children) {
      const probe = path.join(buildDir, child, "zephyr", "zephyr.elf");
      candidates.push({ key: child, fullPath: probe });
    }
  } catch (e) {
    // ignore read errors; build dir may not exist yet
  }

  // Filter to existing ELF files and de-duplicate by path
  const elfSet = new Map<string, string>();
  for (const c of candidates) {
    if (await fs.pathExists(c.fullPath)) {
      elfSet.set(c.fullPath, c.key);
    }
  }

  if (elfSet.size === 0) {
    const choice = await vscode.window.showErrorMessage(
      "No ELF found. Build the project first.",
      "Build Now",
      "Cancel"
    );
    if (choice === "Build Now") {
      await vscode.commands.executeCommand('zephyr-tools.build');
    }
    return;
  }

  // Sort by preference: project name -> app -> default -> tfm -> spm -> others
  // Extract project name from target path (e.g., "nfed/samples/mqtt" -> "mqtt")
  const projectName = project.target.split(path.sep).pop() || "";
  const order = ["app", "default", "tfm", "spm"]; // earlier means lower coreIndex
  const entries = Array.from(elfSet.entries())
    .map(([fullPath, key]) => ({ fullPath, key }))
    .sort((a, b) => {
      // Prioritize project name match above all else
      if (a.key === projectName && b.key !== projectName) return -1;
      if (b.key === projectName && a.key !== projectName) return 1;

      const ai = order.indexOf(a.key);
      const bi = order.indexOf(b.key);
      const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      return av - bv || a.key.localeCompare(b.key);
    });

  // Select a single ELF (primary) to satisfy probe-rs single-core requirement
  const primary = entries[0];
  const relPrimary = path.relative(workspaceUri.fsPath, primary.fullPath).split(path.sep).join("/");
  const coreConfigs = [
    {
      coreIndex: 0,
      programBinary: '${workspaceFolder}/' + relPrimary,
    }
  ];

  // Compose debug configuration
  const configName = `${project.board} • App`;
  const debugConfig: any = {
    name: configName,
    type: "probe-rs-debug",
    request: "attach",
    chip: chipName,
    cwd: "${workspaceFolder}",
    speed: 4000,
    coreConfigs,
    consoleLogLevel: "Console",
    zephyrToolsId: "zephyr-tools.probe-rs",
  };

  // Update launch configurations
  const launchCfg = vscode.workspace.getConfiguration("launch");
  const existing = launchCfg.get<any[]>("configurations") || [];
  const filtered = existing.filter(c => c.zephyrToolsId !== "zephyr-tools.probe-rs");
  filtered.push(debugConfig);

  await launchCfg.update("configurations", filtered, vscode.ConfigurationTarget.Workspace);
  const version = launchCfg.get<string>("version");
  if (!version) {
    await launchCfg.update("version", "0.2.0", vscode.ConfigurationTarget.Workspace);
  }

  vscode.window.showInformationMessage(`Debug configuration created for ${project.board}.`);
}

/**
 * Create/update the config and immediately start the debugger.
 */
export async function debugNowCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Ensure probe-rs debugger is available before starting to avoid VS Code modal
  const dbgAvailable = await ensureProbeRsDebuggerInstalled();
  if (!dbgAvailable) {
    // User needs to install/enable; don't start to avoid modal
    return;
  }
  // Ensure configuration exists/updated
  await createDebugConfigurationCommand(config, context);

  // Resolve workspace and config name
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }
  const folder = folders[0];

  const project = await ProjectConfigManager.load(context);
  if (!project.board) {
    return;
  }
  const configName = `${project.board} • App`;

  // Verify the configuration exists before attempting to start
  const launchCfg = vscode.workspace.getConfiguration("launch");
  const existing = launchCfg.get<any[]>("configurations") || [];
  const hasConfig = existing.some(c => c && c.name === configName && c.type === 'probe-rs-debug');
  if (!hasConfig) {
    vscode.window.showWarningMessage("Debug configuration not found or incomplete. Build the project and try again.");
    return;
  }

  const ok = await vscode.debug.startDebugging(folder, configName);
  if (!ok) {
    vscode.window.showErrorMessage("Failed to start debug session. Check launch configuration.");
  }
}

/**
 * Ensure the probe-rs debugger extension is installed or offer to install.
 */
async function ensureProbeRsDebuggerInstalled(): Promise<boolean> {
  // Try to locate a likely probe-rs debugger extension by ID or fuzzy match
  const preferredId = 'probe-rs.probe-rs-debugger';
  const installedMatch = vscode.extensions.all.find(ext => {
    const id = (ext.id || '').toLowerCase();
    return id === preferredId || (id.includes('probe') && id.includes('rs') && id.includes('debug'));
  });
  const installId = installedMatch?.id || preferredId;

  // Check if any extension (enabled) contributes the probe-rs debugger type
  const hasContrib = vscode.extensions.all.some(ext => {
    try {
      const dbg = (ext.packageJSON?.contributes?.debuggers || []) as any[];
      return dbg.some(d => (d?.type || '').toLowerCase() === 'probe-rs-debug');
    } catch {
      return false;
    }
  });

  if (!hasContrib) {
    // Not contributing; either not installed or disabled
    if (!installedMatch) {
      const action = await vscode.window.showWarningMessage(
        'probe-rs Debugger extension is not installed. Debugging may not be available.',
        'Install',
        'Open Marketplace',
        'Dismiss'
      );
      if (action === 'Install') {
        try {
          await vscode.commands.executeCommand('workbench.extensions.installExtension', installId);
          const reload = await vscode.window.showInformationMessage('probe-rs Debugger installed. Reload to activate.', 'Reload', 'Later');
          if (reload === 'Reload') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        } catch (e) {
          await vscode.env.openExternal(vscode.Uri.parse(`vscode:extension/${installId}`));
        }
      } else if (action === 'Open Marketplace') {
        await vscode.env.openExternal(vscode.Uri.parse(`vscode:extension/${installId}`));
      }
      return false;
    } else {
      // Installed but disabled — offer to enable
      const action = await vscode.window.showWarningMessage(
        'probe-rs Debugger is installed but disabled. Enable it to use debugging.',
        'Enable',
        'Open Extensions',
        'Dismiss'
      );
      if (action === 'Enable') {
        await vscode.commands.executeCommand('workbench.extensions.enableExtension', installedMatch.id);
        const reload = await vscode.window.showInformationMessage('probe-rs Debugger enabled. Reload to activate.', 'Reload', 'Later');
        if (reload === 'Reload') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      } else if (action === 'Open Extensions') {
        await vscode.commands.executeCommand('workbench.extensions.search', `@installed ${installedMatch.id}`);
      }
      return false;
    }
  }

  // Contributed: available; VS Code will activate on demand
  return true;
}

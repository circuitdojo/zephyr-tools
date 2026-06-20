/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { GlobalConfigManager, ProjectConfigManager, ProjectOverridesManager, SettingsManager, ManifestValidator } from "./config";
import { TaskManager } from "./tasks";
import { StatusBarManager, OutputChannelManager, DialogManager, SidebarWebviewProvider } from "./ui";
import { PathManager } from "./environment";
import { GlobalConfig } from "./types";
import {
  setupCommand,
  ensureCompatibleSdk,
  manageSdkCommand,
  buildCommand,
  buildPristineCommand,
  buildMultiCommand,
  buildAllCommand,
  flashCommand,
  flashProbeRsCommand,
  flashAndMonitorCommand,
  flashProbeRsAndMonitorCommand,
  recoverDeviceCommand,
  loadCommand,
  loadAndMonitorCommand,
  setupNewtmgrCommand,
  monitorCommand,
  setupMonitorCommand,
  toggleSerialLoggingCommand,
  changeSerialSettingsCommand,
  changeProjectCommand,
  initRepoCommand,
  changeBoardCommand,
  changeManifestCommand,
  changeRunnerCommand,
  changeSysBuildCommand,
  changeExtraConfFilesCommand,
  changeExtraOverlayFilesCommand,
  changeCMakeDefinesCommand,
  changeProbeRsSettingsCommand,
  createProjectCommand,
  cleanCommand,
  cleanIncompleteProjectCommand,
  updateCommand,
  installRequirementsCommand,
  openBuildFolderCommand,
  revealBuildAssetCommand,
  openZephyrTerminalCommand
} from "./commands";
import { resetPaths } from "./commands/path-management";
import { ZephyrTerminalProfileProvider } from "./providers";

// Global configuration instance
let globalConfig: GlobalConfig;
let sidebarProvider: SidebarWebviewProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize task manager
  TaskManager.init();

  // Load configuration
  globalConfig = await GlobalConfigManager.load(context);

  // Clean up any stale in-progress flags from previous VS Code sessions
  await cleanupStaleProgressFlags(context);
  
  // Reload global config in case it was modified during cleanup
  globalConfig = await GlobalConfigManager.load(context);

  // Auto-detect and populate ZEPHYR_BASE if not set. Done before environment setup
  // so SDK resolution below sees the correct Zephyr tree.
  if (!SettingsManager.getZephyrBase()) {
    const detectedZephyrBase = await SettingsManager.detectZephyrBase();
    if (detectedZephyrBase) {
      await SettingsManager.setZephyrBase(detectedZephyrBase);
      // Also update the environment
      context.environmentVariableCollection.replace("ZEPHYR_BASE", detectedZephyrBase);
    }
  }

  // Auto-select a compatible installed SDK for this workspace's Zephyr tree before
  // building the environment, so PATH/ZEPHYR_SDK_INSTALL_DIR reflect the right SDK.
  await ManifestValidator.checkSdkCompatibility().catch(console.error);

  // Set up environment variable collection
  await setupEnvironmentVariables(context);

  // Extension initialization complete

  // Initialize status bar
  StatusBarManager.initializeStatusBarItems(context);

  // Initialize sidebar webview
  sidebarProvider = new SidebarWebviewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarWebviewProvider.viewType, sidebarProvider)
  );

  // Load project config and update status bar
  await updateStatusBarFromConfig(context);

  // Check if Python dependencies are still present in venv
  await validateProjectDependencies(context);

  // Check SDK version compatibility on activation (advisory — build commands enforce it hard).
  validateToolchainVersion(context).catch(console.error);

  // Keep the in-memory global config in sync with persisted changes. Validation can
  // self-heal the setup flag (e.g. the sidebar restoring isSetup after host tools are
  // confirmed present), and command guards read this variable — without this they
  // would see a stale value and wrongly report "Run setup first".
  context.subscriptions.push(
    GlobalConfigManager.onDidChangeConfig(async () => {
      globalConfig = await GlobalConfigManager.load(context);
    })
  );

  // Auto-save project overrides whenever config changes
  context.subscriptions.push(
    ProjectConfigManager.onDidChangeConfig(async () => {
      const project = await ProjectConfigManager.load(context);
      if (project.target && project.board) {
        await ProjectOverridesManager.save(project.target, project.board, project);
      }
    })
  );

  // Register all commands
  registerCommands(context, sidebarProvider);

  // Register task provider for zephyr-tools task type
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider("zephyr-tools", {
      provideTasks: () => [],
      resolveTask: () => undefined,
    })
  );

  // Register terminal profile provider
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider(
      "zephyr-tools.terminal-profile",
      new ZephyrTerminalProfileProvider(globalConfig)
    )
  );

  // Handle pending tasks
  await handlePendingTasks(context);
}

async function updateStatusBarFromConfig(context: vscode.ExtensionContext): Promise<void> {
  try {
    const project = await ProjectConfigManager.load(context);
    
    // Update status bar with current board and project
    StatusBarManager.updateBoardStatusBar(project.board);
    StatusBarManager.updateProjectStatusBar(project.target);
  } catch (error) {
    console.log('Error loading project config for status bar update:', error);
    // Status bar will show default values (No Board, No Project)
  }
}

async function validateProjectDependencies(context: vscode.ExtensionContext): Promise<void> {
  try {
    const project = await ProjectConfigManager.load(context);
    if (!project.isInit) {
      return;
    }

    const venvPath = path.join(SettingsManager.getToolsDirectory(), "env");
    const markerPath = path.join(venvPath, ".zephyr-init-complete");

    if (!fs.existsSync(markerPath)) {
      project.isInit = false;
      await ProjectConfigManager.save(context, project);
      console.log("Reset project init flag — Python dependencies marker missing from venv");
    }
  } catch {
    // No workspace or config unavailable — nothing to validate
  }
}

async function validateToolchainVersion(_context: vscode.ExtensionContext): Promise<void> {
  // SDK compatibility is surfaced through the sidebar's physical validation
  // ("SDK Update Required") and enforced at build time. A separate popup on
  // every activation is redundant noise — the sidebar already shows what's wrong.
}

async function setupEnvironmentVariables(context: vscode.ExtensionContext): Promise<void> {
  context.environmentVariableCollection.persistent = true;
  
  // Restore PATH modifications if previously set up
  await PathManager.restorePaths(globalConfig, context);
  
  // Set up environment paths (ZEPHYR_BASE, ZEPHYR_SDK_INSTALL_DIR, etc.)
  await PathManager.setupEnvironmentPaths(context, globalConfig);
}

function registerCommands(context: vscode.ExtensionContext, sidebar?: SidebarWebviewProvider): void {
  // Setup command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup", async () => {
      await setupCommand(context);
      // Reload global config after setup
      globalConfig = await GlobalConfigManager.load(context);
    })
  );

  // Install SDK command — installs the SDK version this workspace's Zephyr tree
  // requires automatically (no version prompt). Use Manage SDKs to pick a version.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.install-sdk", async () => {
      await ensureCompatibleSdk(context);
    })
  );

  // Manage SDKs command — list/activate/uninstall installed Zephyr SDKs.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.manage-sdks", async () => {
      await manageSdkCommand(context);
    })
  );

  // Create project command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.create-project", async (dest: vscode.Uri | undefined) => {
      await createProjectCommand(context, globalConfig, dest);
    })
  );

  // Init repo command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.init-repo", async (dest: vscode.Uri | undefined) => {
      // Load fresh: validation may have self-healed isSetup since activation, and the
      // in-memory copy can lag. Avoids a wrong "Run setup first" on Resume.
      globalConfig = await GlobalConfigManager.load(context);
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      
      // Get destination, prompting user if not provided (replicates old helper.get_dest behavior)
      const destination = await DialogManager.getDestination(dest);
      if (destination) {
        await initRepoCommand(globalConfig, context, destination);
      }
      // If destination is null, the user cancelled or error message was already shown
    })
  );

  // Build commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await buildCommand(globalConfig, context, false, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build-pristine", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await buildPristineCommand(globalConfig, context, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build-multi", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await buildMultiCommand(globalConfig, context, false, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build-all", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await buildAllCommand(globalConfig, context, false, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build-multi-pristine", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await buildMultiCommand(globalConfig, context, true, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build-all-pristine", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await buildAllCommand(globalConfig, context, true, sidebar);
    })
  );

  // Flash commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await flashCommand(globalConfig, context, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash-probe-rs", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await flashProbeRsCommand(globalConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash-and-monitor", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await flashAndMonitorCommand(globalConfig, context, sidebar);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash-probe-rs-and-monitor", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await flashProbeRsAndMonitorCommand(globalConfig, context);
    })
  );

  // Recovery command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.recover-device", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await recoverDeviceCommand(globalConfig, context);
    })
  );

  // Load commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.load", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await loadCommand(globalConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.load-and-monitor", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      await loadAndMonitorCommand(globalConfig, context);
    })
  );

  // Newtmgr setup
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup-newtmgr", async () => {
      await setupNewtmgrCommand(globalConfig, context);
    })
  );

  // Monitor commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.monitor", async () => {
      await monitorCommand(globalConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup-monitor", async () => {
      await setupMonitorCommand(globalConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.toggle-serial-logging", async () => {
      await toggleSerialLoggingCommand(globalConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-serial-settings", async () => {
      await changeSerialSettingsCommand(globalConfig, context);
    })
  );


  // Board management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-board", async () => {
      await changeBoardCommand(globalConfig, context);
    })
  );

  // Project management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-project", async () => {
      await changeProjectCommand(globalConfig, context);
    })
  );

  // Manifest management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-west-manifest", async () => {
      await changeManifestCommand(globalConfig, context);
    })
  );

  // Runner management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-runner", async () => {
      await changeRunnerCommand(globalConfig, context);
    })
  );

  // Sysbuild management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-sysbuild", async () => {
      await changeSysBuildCommand(globalConfig, context);
    })
  );

  // Extra conf files management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-extra-conf-files", async () => {
      await changeExtraConfFilesCommand(globalConfig, context);
    })
  );

  // Extra overlay files management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-extra-overlay-files", async () => {
      await changeExtraOverlayFilesCommand(globalConfig, context);
    })
  );

  // CMake defines management
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-cmake-defines", async () => {
      await changeCMakeDefinesCommand(globalConfig, context);
    })
  );

  // Probe-rs settings
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-probe-rs-settings", async () => {
      await changeProbeRsSettingsCommand(globalConfig, context);
    })
  );

  // Clean command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.clean", async () => {
      await cleanCommand(globalConfig, context);
    })
  );

  // Clean incomplete project command (internal use only - not exposed in command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools._clean-incomplete-project", async () => {
      await cleanIncompleteProjectCommand(globalConfig, context);
    })
  );

  // Update command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.update", async () => {
      await updateCommand(globalConfig, context, sidebar);
    })
  );

  // Install Python requirements command — refresh deps without running west update.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.install-requirements", async () => {
      await installRequirementsCommand(globalConfig, context);
    })
  );

  // Build assets commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.open-build-folder", async () => {
      await openBuildFolderCommand(globalConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.reveal-build-asset", async (filePath: string) => {
      await revealBuildAssetCommand(globalConfig, context, filePath);
    })
  );

  // Path management command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.reset-paths", resetPaths)
  );

  // Zephyr terminal command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.open-zephyr-terminal", async () => {
      await openZephyrTerminalCommand(globalConfig, context);
    })
  );

  // Debug configuration command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.create-debug-config", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      const { createDebugConfigurationCommand } = await import('./commands/debug');
      await createDebugConfigurationCommand(globalConfig, context);
    })
  );

  // Debug now command: updates config and starts debugger
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.debug-now", async () => {
      if (!globalConfig.isSetup) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
      const { debugNowCommand } = await import('./commands/debug');
      await debugNowCommand(globalConfig, context);
    })
  );
}

async function handlePendingTasks(context: vscode.ExtensionContext): Promise<void> {
  const pendingTask = await ProjectConfigManager.loadPendingTask(context);
  
  if (pendingTask?.name) {
    // Reveal sidebar for init-repo tasks since they will show progress
    if (pendingTask.name === "zephyr-tools.init-repo" && sidebarProvider) {
      await sidebarProvider.revealSidebar();
    }
    
    await ProjectConfigManager.clearPendingTask(context);
    await vscode.commands.executeCommand(pendingTask.name, pendingTask.data);
  }
}

async function cleanupStaleProgressFlags(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Clean up setup progress if setup is actually complete
    const globalConfig = await GlobalConfigManager.load(context);
    if (globalConfig.isSetupInProgress && globalConfig.isSetup) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const manifest = require("../manifest/manifest.json");
      if (globalConfig.manifestVersion === manifest.version) {
        console.log('Cleaning up stale setup progress flag - setup is already complete');
        globalConfig.isSetupInProgress = false;
        await GlobalConfigManager.save(context, globalConfig);
      }
    }

    // Clean up initialization progress - but be careful about pending tasks
    const projectConfig = await ProjectConfigManager.load(context);
    const pendingTask = await ProjectConfigManager.loadPendingTask(context);
    
    if (projectConfig.isInitializing) {
      // If init is complete, clean up the flag
      if (projectConfig.isInit) {
        console.log('Cleaning up initialization progress flag - initialization is complete');
        projectConfig.isInitializing = false;
        await ProjectConfigManager.save(context, projectConfig);
      }
      // If there's a pending init-repo task, keep the flag (legitimate restart scenario)
      else if (!pendingTask || pendingTask.name !== "zephyr-tools.init-repo") {
        // No pending init task and init not complete = stale flag from crashed session
        console.log('Cleaning up stale initialization progress flag - no pending task and init incomplete');
        projectConfig.isInitializing = false;
        await ProjectConfigManager.save(context, projectConfig);
      }
      // If there IS a pending init-repo task, leave isInitializing true so UI shows progress
      else {
        console.log('Keeping initialization progress flag - pending init-repo task detected');
      }
    }
  } catch (error) {
    console.error('Error cleaning up stale progress flags:', error);
    // Don't throw - extension should still activate even if cleanup fails
  }
}

export function deactivate() {
  // Cleanup resources
  StatusBarManager.dispose();
  OutputChannelManager.dispose();
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfigManager, ProjectConfigManager } from "./config";
import { TaskManager } from "./tasks";
import { StatusBarManager, OutputChannelManager, DialogManager, SidebarWebviewProvider } from "./ui";
import { PathManager } from "./environment";
import { GlobalConfig, ProjectConfig } from "./types";
import {
  setupCommand,
  buildCommand,
  buildPristineCommand,
  flashCommand,
  flashProbeRsCommand,
  flashAndMonitorCommand,
  flashProbeRsAndMonitorCommand,
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
  changeRunnerCommand,
  changeSysBuildCommand,
  changeProbeRsSettingsCommand,
  createProjectCommand,
  cleanCommand,
  updateCommand,
  openBuildFolderCommand,
  revealBuildAssetCommand,
  openZephyrTerminalCommand
} from "./commands";

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

  // Set up environment variable collection
  setupEnvironmentVariables(context);

  // Initialize status bar
  StatusBarManager.initializeStatusBarItems(context);

  // Initialize sidebar webview
  sidebarProvider = new SidebarWebviewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarWebviewProvider.viewType, sidebarProvider)
  );

  // Load project config and update status bar
  await updateStatusBarFromConfig(context);

  // Register all commands
  registerCommands(context, sidebarProvider);

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

function setupEnvironmentVariables(context: vscode.ExtensionContext): void {
  context.environmentVariableCollection.persistent = true;
  
  // Restore PATH modifications if previously set up
  PathManager.restorePaths(globalConfig, context);
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

  // Create project command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.create-project", async (dest: vscode.Uri | undefined) => {
      await createProjectCommand(context, globalConfig, dest);
    })
  );

  // Init repo command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.init-repo", async (dest: vscode.Uri | undefined) => {
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

  // Update command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.update", async () => {
      await updateCommand(globalConfig, context);
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

  // Zephyr terminal command
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.open-zephyr-terminal", async () => {
      await openZephyrTerminalCommand(globalConfig, context);
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

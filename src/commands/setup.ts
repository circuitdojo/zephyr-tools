/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { Manifest, ManifestEntry } from "../types";
import { GlobalConfigManager, SettingsManager } from "../config";
import {
  findSuitablePython,
  validateGitInstallation,
  createVirtualEnvironment,
  installWest,
  setupVirtualEnvironmentPaths
} from "../environment";
import { OutputChannelManager } from "../ui";
import { TaskManager } from "../tasks";
import { arch, platform } from "../config";
import { FileDownloader } from "../files";
import { processDownloadWithValidation } from "./download-processor";

// Manifest data
// eslint-disable-next-line @typescript-eslint/no-require-imports
const manifest: Manifest = require("../../manifest/manifest.json");

export async function setupCommand(context: vscode.ExtensionContext): Promise<void> {
  // Reset configuration
  await GlobalConfigManager.reset(context);
  const config = await GlobalConfigManager.load(context);
  
  // Environment is already normalized by GlobalConfigManager
  
  // Set setup in progress flag and save config to trigger sidebar update
  config.isSetupInProgress = true;
  await GlobalConfigManager.save(context, config);
  
  // Track all paths added during setup
  const allAddedPaths: string[] = [];
  
  try {
    // Clear any existing PATH modifications
    context.environmentVariableCollection.clear();

  // Define what manifest to use
  let platformManifest: ManifestEntry[] | undefined;
  switch (platform) {
    case "darwin":
      platformManifest = manifest.darwin;
      break;
    case "linux":
      platformManifest = manifest.linux;
      break;
    case "win32":
      platformManifest = manifest.win32;
      break;
  }

  // Skip out if not found
  if (platformManifest === undefined) {
    vscode.window.showErrorMessage("Unsupported platform for Zephyr Tools!");
    return;
  }

  // Setup installs host tooling only. The Zephyr SDK is managed separately by the
  // `Zephyr Tools: Install SDK` command, so multiple SDK versions can coexist and
  // be selected per-workspace. We prompt to install one at the end of setup.

  // Show setup progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Setting up Zephyr dependencies",
      cancellable: false,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        TaskManager.cancel();
        console.log("User canceled the long running operation");
      });

      const output = OutputChannelManager.getChannel();
      output.clear();
      output.show();

      // Get current tools directory from settings
      const currentToolsDir = SettingsManager.getToolsDirectory();

      // Check if directory in $HOME exists
      const exists = await fs.pathExists(currentToolsDir);
      if (!exists) {
        console.log("toolsdir not found");
        await fs.mkdirp(currentToolsDir);
      }

      progress.report({ increment: 5 });

      // Validate Git installation
      const env = SettingsManager.buildEnvironmentForExecution();
      if (!(await validateGitInstallation(env, output))) {
        vscode.window.showErrorMessage("Unable to continue. Git not installed. Check output for more info.");
        return;
      }

      progress.report({ increment: 5 });

      // Find suitable Python version
      const suitablePython = await findSuitablePython(output);
      if (!suitablePython) {
        vscode.window.showErrorMessage("Python 3.10+ is required for Zephyr development. Check output for details.");
        return;
      }

      output.appendLine(`[SETUP] Using Python: ${suitablePython}`);
      progress.report({ increment: 5 });

      // Create virtual environment
      if (!(await createVirtualEnvironment(suitablePython, env, output))) {
        vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
        return;
      }

      progress.report({ increment: 5 });

      // Setup virtual environment paths
      await setupVirtualEnvironmentPaths(env, context);

      // Install west
      if (!(await installWest(suitablePython, env, output))) {
        vscode.window.showErrorMessage("Error installing west. Check output for more info.");
        return;
      }

      progress.report({ increment: 5 });

      // Initialize FileDownloader
      FileDownloader.init(path.join(currentToolsDir, "downloads"));

      // Process platform host dependencies (cmake, ninja, west tooling, etc.).
      // The Zephyr SDK is installed separately via `Zephyr Tools: Install SDK`.
      for (const element of platformManifest) {
        if (element.arch === arch) {
          for (const download of element.downloads) {
            progress.report({ increment: 2, message: `Processing ${download.name}...` });
            const result = await processDownloadWithValidation(download, config, context, output, allAddedPaths);
            if (!result) {
              output.appendLine(`[SETUP] ABORTING: Failed to process dependency ${download.name}`);
              vscode.window.showErrorMessage(`Failed to process dependency ${download.name}. Check output for details.`);
              return;
            }
            progress.report({ increment: 3, message: `Completed ${download.name}` });
          }
          break;
        }
      }

      output.appendLine("[SETUP] Zephyr setup complete!");
      
      // Save manifest version and clear setup progress flag
      config.manifestVersion = manifest.version;
      config.isSetup = true;
      config.isSetupInProgress = false;

      // Save configuration
      await GlobalConfigManager.save(context, config);

      // Save detected tool paths to settings if they're not already set
      if (!SettingsManager.getPythonExecutable()) {
        await SettingsManager.setPythonExecutable(suitablePython);
      }
      
      // Save West executable path
      const westPath = path.join(currentToolsDir, "env", platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "west.exe" : "west");
      if (!SettingsManager.getWestExecutable() && await fs.pathExists(westPath)) {
        await SettingsManager.setWestExecutable(westPath);
      }
      
      // Save ZEPHYR_BASE to dedicated setting if it was configured
      const zephyrBase = SettingsManager.getEnvironmentVariable("ZEPHYR_BASE");
      if (zephyrBase) {
        await SettingsManager.setZephyrBase(zephyrBase);
      }
      
      // Save host tool paths to global settings. SDK paths are added separately
      // by the SDK installer and derived per-workspace at activation time.
      if (allAddedPaths.length > 0) {
        await SettingsManager.setAllPaths(allAddedPaths);
      }

      progress.report({ increment: 100 });

      vscode.window.showInformationMessage("Zephyr Tools setup complete!");
    }
  );

  // Setup installs host tooling only. The Zephyr SDK is installed automatically by
  // Init Repo (and by build/update as a safety net), once the project's Zephyr tree
  // is present and the required SDK version is known.
  } catch (error) {
    // Clear setup progress flag on any error
    config.isSetupInProgress = false;
    await GlobalConfigManager.save(context, config);
    
    // Re-throw the error so it's handled by the caller
    throw error;
  } finally {
    // Ensure setup progress flag is cleared if not already done
    if (config.isSetupInProgress) {
      config.isSetupInProgress = false;
      await GlobalConfigManager.save(context, config);
    }
  }
}

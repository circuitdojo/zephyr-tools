/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";
import * as cp from "child_process";
import { GlobalConfig, Manifest, ManifestEntry, ManifestToolchainEntry, ManifestDownloadEntry } from "../types";
import { GlobalConfigManager } from "../config";
import { 
  findSuitablePython, 
  validateGitInstallation, 
  createVirtualEnvironment,
  installWest,
  setupVirtualEnvironmentPaths
} from "../environment";
import { OutputChannelManager } from "../ui";
import { TaskManager } from "../tasks";
import { toolsDir, arch, platform, pathdivider } from "../config";
import { FileDownloader, ArchiveExtractor } from "../files";

// Manifest data
const manifest: Manifest = require("../../manifest/manifest.json");

/**
 * Process a download entry with validation and error handling
 */
async function processDownloadWithValidation(
  download: ManifestDownloadEntry,
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<boolean> {
  output.appendLine(`[SETUP] Starting processing: ${download.name}`);
  output.appendLine(`[SETUP] URL: ${download.url}`);
  output.appendLine(`[SETUP] Expected MD5: ${download.md5}`);

  const result = await processDownload(download, config, context, output);

  if (result) {
    output.appendLine(`[SETUP] Successfully completed: ${download.name}`);
  } else {
    output.appendLine(`[SETUP] FAILED to process: ${download.name}`);
  }

  return result;
}

/**
 * Process a single download entry from the manifest
 */
async function processDownload(
  download: ManifestDownloadEntry,
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  // Check if file already exists
  let filepath: string | null = await FileDownloader.exists(download.filename);

  // Download if doesn't exist or hash doesn't match
  if (filepath === null || !(await FileDownloader.check(download.filename, download.md5))) {
    output.appendLine(`[SETUP] downloading ${download.url}`);

    try {
      filepath = await FileDownloader.fetch(download.url);
    } catch (error) {
      output.appendLine(`[SETUP] Failed to download ${download.filename}: ${error}`);
      return false;
    }

    // Check hash again
    if (!(await FileDownloader.check(download.filename, download.md5))) {
      output.appendLine(`[SETUP] Checksum mismatch for ${download.filename}`);
      return false;
    }
  }

  // Ensure filepath is not null
  if (filepath === null) {
    output.appendLine(`[SETUP] Critical error: filepath is null for ${download.filename}`);
    return false;
  }

  // Determine target path
  let copytopath = path.join(toolsDir, download.name);
  output.appendLine(`[SETUP] Initial copytopath: ${copytopath}`);

  // Add subfolder if specified
  if (download.copy_to_subfolder) {
    copytopath = path.join(copytopath, download.copy_to_subfolder);
    output.appendLine(`[SETUP] Updated copytopath with subfolder: ${copytopath}`);
  }

  // Create target directory if it doesn't exist
  if (!(await fs.pathExists(copytopath))) {
    await fs.mkdirp(copytopath);
    output.appendLine(`[SETUP] Created target directory: ${copytopath}`);
  }

  // Clear target directory if specified (default behavior)
  if (download.clear_target !== false) {
    try {
      await fs.remove(copytopath);
      await fs.mkdirp(copytopath);
      output.appendLine(`[SETUP] Cleared and recreated target directory: ${copytopath}`);
    } catch (error) {
      output.appendLine(`[SETUP] Failed to prepare target directory: ${error}`);
      return false;
    }
  } else {
    output.appendLine(`[SETUP] Preserving existing target directory: ${copytopath}`);
  }

  // Extract archive based on file type
  try {
    if (download.url.includes(".zip") || download.url.includes(".7z") || download.url.includes(".tar")) {
      output.appendLine(`[SETUP] Extracting ${filepath} to ${copytopath}`);
      
      const extractionSuccess = await ArchiveExtractor.extractArchive(filepath, copytopath);
      if (!extractionSuccess) {
        output.appendLine(`[SETUP] Archive extraction failed for ${download.name}`);
        return false;
      }
    }
  } catch (error) {
    output.appendLine(`[SETUP] Extraction error for ${download.name}: ${error}`);
    return false;
  }

  // Set up PATH environment variable
  if (download.suffix) {
    const setpath = path.join(copytopath, download.suffix);
    config.env["PATH"] = setpath + pathdivider + config.env["PATH"];
    
    // Add to VS Code environment collection
    context.environmentVariableCollection.prepend("PATH", setpath + pathdivider);
  } else {
    // If no suffix, assume the copytopath contains executables and should be added to PATH
    config.env["PATH"] = copytopath + pathdivider + config.env["PATH"];
    
    // Add to VS Code environment collection
    context.environmentVariableCollection.prepend("PATH", copytopath + pathdivider);
  }

  // Set remaining environment variables
  for (const entry of download.env ?? []) {
    if (entry.value) {
      config.env[entry.name] = entry.value;
    } else if (entry.usepath && !entry.append) {
      config.env[entry.name] = path.join(copytopath, entry.suffix ?? "");
    } else if (entry.usepath && entry.append) {
      config.env[entry.name] = path.join(
        copytopath,
        (entry.suffix ?? "") + pathdivider + (config.env[entry.name] ?? "")
      );
    }
    console.log(`env[${entry.name}]: ${config.env[entry.name]}`);
  }

  // Save configuration to disk
  await GlobalConfigManager.save(context, config);

  // Run any required commands
  for (const entry of download.cmd ?? []) {
    output.appendLine(`[SETUP] Running command: ${entry.cmd}`);

    let cmd = entry.cmd;
    if (entry.usepath) {
      cmd = path.join(copytopath, entry.cmd);
    }

    try {
      const result = await exec(cmd, { env: config.env });
      output.append(result.stdout);
      if (result.stderr) {
        output.append(result.stderr);
      }
    } catch (error: any) {
      output.appendLine(`[SETUP] Command failed: ${error.message}`);
      if (error.stdout) output.append(error.stdout);
      if (error.stderr) output.append(error.stderr);
      return false;
    }
  }

  return true;
}

export async function setupCommand(context: vscode.ExtensionContext): Promise<void> {
  // Reset configuration
  await GlobalConfigManager.reset(context);
  const config = await GlobalConfigManager.load(context);
  config.env["PATH"] = process.env["PATH"];
  
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

  // Pre-select toolchain before showing progress
  let selectedEntry: ManifestToolchainEntry | undefined;
  for (const element of platformManifest) {
    if (element.arch === arch) {
      // Get each "name" entry and present as choice to user
      let choices: string[] = [];
      for (let entry of element.toolchains) {
        choices.push(entry.name);
      }

      // Prompt user
      let selection = await vscode.window.showQuickPick(choices, {
        ignoreFocusOut: true,
        placeHolder: "Which toolchain would you like to install?",
      });

      // Check if user canceled
      if (selection === undefined) {
        vscode.window.showErrorMessage("Zephyr Tools Setup canceled.");
        return;
      }

      // Find the correct entry
      selectedEntry = element.toolchains.find(element => element.name === selection);

      if (selectedEntry === undefined) {
        vscode.window.showErrorMessage("Unable to find toolchain entry.");
        return;
      }

      break;
    }
  }

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

      // Check if directory in $HOME exists
      let exists = await fs.pathExists(toolsDir);
      if (!exists) {
        console.log("toolsdir not found");
        await fs.mkdirp(toolsDir);
      }

      progress.report({ increment: 5 });

      // Validate Git installation
      if (!(await validateGitInstallation(config.env, output))) {
        vscode.window.showErrorMessage("Unable to continue. Git not installed. Check output for more info.");
        return;
      }

      progress.report({ increment: 5 });

      // Find suitable Python version
      let suitablePython = await findSuitablePython(output);
      if (!suitablePython) {
        vscode.window.showErrorMessage("Python 3.10+ is required for Zephyr development. Check output for details.");
        return;
      }

      output.appendLine(`[SETUP] Using Python: ${suitablePython}`);
      progress.report({ increment: 5 });

      // Create virtual environment
      if (!(await createVirtualEnvironment(suitablePython, config.env, output))) {
        vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
        return;
      }

      progress.report({ increment: 5 });

      // Setup virtual environment paths
      setupVirtualEnvironmentPaths(config.env, context);

      // Install west
      if (!(await installWest(suitablePython, config.env, output))) {
        vscode.window.showErrorMessage("Error installing west. Check output for more info.");
        return;
      }

      progress.report({ increment: 5 });

      // Initialize FileDownloader
      FileDownloader.init(path.join(toolsDir, "downloads"));

      // Process platform dependencies and toolchain
      for (const element of platformManifest) {
        if (element.arch === arch) {
          // Process general dependencies first
          for (const download of element.downloads) {
            progress.report({ increment: 2, message: `Processing ${download.name}...` });
            const result = await processDownloadWithValidation(download, config, context, output);
            if (!result) {
              output.appendLine(`[SETUP] ABORTING: Failed to process dependency ${download.name}`);
              vscode.window.showErrorMessage(`Failed to process dependency ${download.name}. Check output for details.`);
              return;
            }
            progress.report({ increment: 3, message: `Completed ${download.name}` });
          }

          // Process selected toolchain
          if (selectedEntry) {
            output.appendLine(`[SETUP] Installing ${selectedEntry.name} toolchain...`);
            for (const download of selectedEntry.downloads) {
              progress.report({ increment: 2, message: `Processing toolchain ${download.name}...` });
              const result = await processDownloadWithValidation(download, config, context, output);
              if (!result) {
                output.appendLine(`[SETUP] ABORTING: Failed to process toolchain ${download.name}`);
                vscode.window.showErrorMessage(`Failed to process toolchain ${download.name}. Check output for details.`);
                return;
              }
              progress.report({ increment: 3, message: `Completed ${download.name}` });
            }
          }
          break;
        }
      }

      output.appendLine("[SETUP] Zephyr setup complete!");
      
      // Save manifest version
      config.manifestVersion = manifest.version;
      config.isSetup = true;

      // Save configuration
      await GlobalConfigManager.save(context, config);

      progress.report({ increment: 100 });

      vscode.window.showInformationMessage("Zephyr Tools setup complete!");
    }
  );
}

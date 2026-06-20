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
import { GlobalConfig, ManifestDownloadEntry } from "../types";
import { GlobalConfigManager, SettingsManager } from "../config";
import { pathdivider } from "../config";
import { FileDownloader, ArchiveExtractor } from "../files";

/**
 * Process a download entry with validation and logging.
 *
 * Shared by the host-tools setup flow and the standalone SDK installer so both
 * download/extract/PATH/env logic stays in one place.
 */
export async function processDownloadWithValidation(
  download: ManifestDownloadEntry,
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  allAddedPaths: string[]
): Promise<boolean> {
  output.appendLine(`[SETUP] Starting processing: ${download.name}`);
  output.appendLine(`[SETUP] URL: ${download.url}`);
  output.appendLine(`[SETUP] Expected SHA256: ${download.sha256}`);

  const result = await processDownload(download, config, context, output, allAddedPaths);

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
export async function processDownload(
  download: ManifestDownloadEntry,
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  allAddedPaths: string[]
): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  // Check if file already exists
  let filepath: string | null = await FileDownloader.exists(download.filename);

  // Download if doesn't exist or hash doesn't match
  if (filepath === null || !(await FileDownloader.check(download.filename, download.sha256))) {
    output.appendLine(`[SETUP] downloading ${download.url}`);

    try {
      filepath = await FileDownloader.fetch(download.url);
    } catch (error) {
      output.appendLine(`[SETUP] Failed to download ${download.filename}: ${error}`);
      return false;
    }

    // Check hash again
    if (!(await FileDownloader.check(download.filename, download.sha256))) {
      output.appendLine(`[SETUP] Checksum mismatch for ${download.filename}`);
      return false;
    }
  }

  // Ensure filepath is not null
  if (filepath === null) {
    output.appendLine(`[SETUP] Critical error: filepath is null for ${download.filename}`);
    return false;
  }

  // Determine target path - use settings-based tools directory
  const currentToolsDir = SettingsManager.getToolsDirectory();
  let copytopath = path.join(currentToolsDir, download.name);
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

  // Clear target directory if specified (default behavior).
  // For toolchain archives whose suffix begins with a versioned SDK directory
  // (e.g. "zephyr-sdk-1.0.0/arm-zephyr-eabi/bin"), only remove that specific
  // version directory so multiple SDK versions can coexist in the parent dir.
  if (download.clear_target !== false) {
    try {
      const suffixFirstComponent = download.suffix?.split(/[\\/]/)[0];
      const isSdkVersionDir = suffixFirstComponent?.startsWith('zephyr-sdk-');
      const clearTarget = isSdkVersionDir
        ? path.join(copytopath, suffixFirstComponent!)
        : copytopath;

      await fs.remove(clearTarget);
      await fs.mkdirp(copytopath);
      output.appendLine(`[SETUP] Cleared target: ${clearTarget}`);
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

    // Add to VS Code environment collection
    context.environmentVariableCollection.prepend("PATH", setpath + pathdivider);

    // Track this path
    allAddedPaths.push(setpath);
    output.appendLine(`[SETUP] Added to PATH: ${setpath}`);
  } else {
    // If no suffix, assume the copytopath contains executables and should be added to PATH

    // Add to VS Code environment collection
    context.environmentVariableCollection.prepend("PATH", copytopath + pathdivider);

    // Track this path
    allAddedPaths.push(copytopath);
    output.appendLine(`[SETUP] Added to PATH: ${copytopath}`);
  }

  // Set remaining environment variables in settings
  for (const entry of download.env ?? []) {
    // The SDK install dir is workspace-scoped (paths.sdkInstallDir) and managed by
    // the SDK install/selection flow. Never persist it through the generic global
    // env path: a global ZEPHYR_SDK_INSTALL_DIR acts as a fallback that can
    // resurrect an uninstalled SDK after the workspace setting is cleared.
    if (entry.name === "ZEPHYR_SDK_INSTALL_DIR") {
      continue;
    }

    let envValue: string;
    if (entry.value) {
      envValue = entry.value;
    } else if (entry.usepath && !entry.append) {
      envValue = path.join(copytopath, entry.suffix ?? "");
    } else if (entry.usepath && entry.append) {
      const existingValue = SettingsManager.getZephyrBase() || ""; // For ZEPHYR_BASE mainly
      envValue = path.join(
        copytopath,
        (entry.suffix ?? "") + pathdivider + existingValue
      );
    } else {
      continue;
    }

    // Save environment variable to settings
    await SettingsManager.setEnvironmentVariable(entry.name, envValue);

    // Also save ZEPHYR_BASE to its dedicated setting
    if (entry.name === "ZEPHYR_BASE") {
      await SettingsManager.setZephyrBase(envValue);
    }

    // Set environment variable in VS Code environment collection
    context.environmentVariableCollection.replace(entry.name, envValue);

    output.appendLine(`[SETUP] Set ${entry.name}: ${envValue}`);
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
      const result = await exec(cmd, { env: SettingsManager.buildEnvironmentForExecution() });
      output.append(result.stdout);
      if (result.stderr) {
        output.append(result.stderr);
      }
    } catch (error: unknown) {
      const errObj = error as { message?: string; stdout?: string; stderr?: string };
      output.appendLine(`[SETUP] Command failed: ${errObj.message}`);
      if (errObj.stdout) {output.append(errObj.stdout);}
      if (errObj.stderr) {output.append(errObj.stderr);}
      return false;
    }
  }

  return true;
}

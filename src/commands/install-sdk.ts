/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { Manifest, ManifestEntry, ManifestToolchainEntry } from "../types";
import { GlobalConfigManager, SettingsManager, ManifestValidator } from "../config";
import { arch, platform } from "../config";
import { OutputChannelManager } from "../ui";
import { PathManager } from "../environment";
import { FileDownloader } from "../files";
import { processDownloadWithValidation } from "./download-processor";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const manifest: Manifest = require("../../manifest/manifest.json");

/**
 * Returns the manifest entry for the current platform + architecture, if supported.
 */
function getPlatformArchEntry(): ManifestEntry | undefined {
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
  return platformManifest?.find(entry => entry.arch === arch);
}

/**
 * The SDK toolchains the manifest can install on this platform/arch.
 */
export function getAvailableSdks(): ManifestToolchainEntry[] {
  return getPlatformArchEntry()?.toolchains ?? [];
}

// Parses a "zephyr-sdk-1.0.0" / "1.0.0" string into a numeric tuple for comparison.
function parseSdkVersion(name: string): number[] {
  const match = name.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) { return [0, 0, 0]; }
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersionTuples(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) { return diff; }
  }
  return 0;
}

/**
 * Picks the best manifest SDK to satisfy a Zephyr tree's required SDK version.
 *
 * A Zephyr tree requesting e.g. "0.16" needs an SDK that is >= 0.16 and on the
 * same major line (SDK 1.0 dropped backward compatibility with 0.x trees), so we
 * choose the lowest manifest version on the required major line that is >= required.
 */
export function recommendSdkForRequired(required: string): ManifestToolchainEntry | undefined {
  const req = parseSdkVersion(required);
  const candidates = getAvailableSdks()
    .map(sdk => ({ sdk, version: parseSdkVersion(sdk.name) }))
    .filter(({ version }) => version[0] === req[0] && compareVersionTuples(version, req) >= 0)
    .sort((a, b) => compareVersionTuples(a.version, b.version));
  return candidates[0]?.sdk;
}

/**
 * Installs a Zephyr SDK toolchain into the shared toolchain directory.
 *
 * Multiple SDK versions coexist; after installing, the workspace's active SDK is
 * re-resolved (auto-selecting the best installed SDK compatible with this project's
 * Zephyr tree) and the environment is rebuilt. Returns true on success.
 *
 * @param version Optional SDK name (e.g. "zephyr-sdk-0.16.4") to install without prompting.
 */
export async function installSdkCommand(
  context: vscode.ExtensionContext,
  version?: string
): Promise<boolean> {
  const config = await GlobalConfigManager.load(context);

  // Host tooling must be present first — the SDK install reuses the tools dir,
  // downloader and environment created by Setup.
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` before installing an SDK.");
    return false;
  }

  const archEntry = getPlatformArchEntry();
  if (!archEntry || archEntry.toolchains.length === 0) {
    vscode.window.showErrorMessage(`No Zephyr SDKs are available for ${platform}-${arch}.`);
    return false;
  }

  // Resolve which SDK to install.
  let selectedEntry: ManifestToolchainEntry | undefined;
  if (version) {
    selectedEntry = archEntry.toolchains.find(t => t.name === version);
    if (!selectedEntry) {
      vscode.window.showErrorMessage(`Unknown Zephyr SDK: ${version}`);
      return false;
    }
  } else {
    const selection = await vscode.window.showQuickPick(
      archEntry.toolchains.map(t => t.name),
      { ignoreFocusOut: true, placeHolder: "Which Zephyr SDK would you like to install?" }
    );
    if (selection === undefined) {
      return false; // user canceled
    }
    selectedEntry = archEntry.toolchains.find(t => t.name === selection);
  }

  if (!selectedEntry) {
    vscode.window.showErrorMessage("Unable to find the selected Zephyr SDK entry.");
    return false;
  }

  const entry = selectedEntry;

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing ${entry.name}`,
      cancellable: false,
    },
    async (progress): Promise<boolean> => {
      const output = OutputChannelManager.getChannel();
      output.clear();
      output.show();

      const currentToolsDir = SettingsManager.getToolsDirectory();
      await fs.mkdirp(currentToolsDir);
      FileDownloader.init(path.join(currentToolsDir, "downloads"));

      output.appendLine(`[SETUP] Installing ${entry.name} toolchain...`);
      const addedPaths: string[] = [];
      for (const download of entry.downloads) {
        progress.report({ message: `Downloading ${download.name}...` });
        const result = await processDownloadWithValidation(download, config, context, output, addedPaths);
        if (!result) {
          output.appendLine(`[SETUP] ABORTING: Failed to process toolchain ${download.name}`);
          vscode.window.showErrorMessage(`Failed to install ${entry.name}. Check output for details.`);
          return false;
        }
      }

      // The SDK install dir is the version-named directory under the toolchain dir.
      const sdkInstallDir = path.join(currentToolsDir, "toolchain", entry.name);

      // Re-resolve the workspace's active SDK. This auto-selects the best installed
      // SDK compatible with the current Zephyr tree (which may be the one just
      // installed), keeping selection consistent with on-the-fly switching.
      const sdkError = await ManifestValidator.checkSdkCompatibility();

      // If there is no Zephyr tree yet (no required version to resolve against),
      // make the just-installed SDK the active one so the workspace has a default.
      if (sdkError === undefined && !SettingsManager.getSdkInstallDir()) {
        await SettingsManager.setSdkInstallDir(sdkInstallDir);
      }

      // Rebuild PATH / ZEPHYR_SDK_INSTALL_DIR from the (possibly switched) setting.
      await PathManager.setupEnvironmentPaths(context, config);

      output.appendLine(`[SETUP] ${entry.name} installed.`);
      vscode.window.showInformationMessage(`${entry.name} installed.`);
      return true;
    }
  );
}

export interface InstalledSdk {
  name: string;
  version: string;
  path: string;
}

/**
 * Lists the Zephyr SDKs currently installed under the shared toolchain directory,
 * sorted highest version first.
 */
export async function getInstalledSdks(): Promise<InstalledSdk[]> {
  const toolchainDir = path.join(SettingsManager.getToolsDirectory(), "toolchain");
  if (!(await fs.pathExists(toolchainDir))) { return []; }

  const entries = await fs.readdir(toolchainDir);
  const installed: InstalledSdk[] = [];
  for (const entry of entries) {
    if (!entry.startsWith("zephyr-sdk-")) { continue; }
    const sdkPath = path.join(toolchainDir, entry);
    const version = await ManifestValidator.getInstalledSdkVersion(sdkPath);
    if (!version) { continue; }
    installed.push({ name: entry, version, path: sdkPath });
  }

  installed.sort((a, b) => compareVersionTuples(parseSdkVersion(b.version), parseSdkVersion(a.version)));
  return installed;
}

interface SdkQuickPickItem extends vscode.QuickPickItem {
  sdkPath?: string;
  install?: boolean;
}

/**
 * Interactive management of installed Zephyr SDKs: shows the installed versions
 * (marking the active one), lets the user activate a different version for this
 * workspace, uninstall versions, or install a new one.
 */
export async function manageSdkCommand(context: vscode.ExtensionContext): Promise<void> {
  const config = await GlobalConfigManager.load(context);
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` before managing SDKs.");
    return;
  }

  const uninstallButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("trash"),
    tooltip: "Uninstall",
  };

  const qp = vscode.window.createQuickPick<SdkQuickPickItem>();
  qp.title = "Manage Zephyr SDKs";
  qp.placeholder = "Select an SDK to activate for this workspace, or install a new one";

  const refresh = async (): Promise<void> => {
    qp.busy = true;
    const installed = await getInstalledSdks();
    const active = SettingsManager.getSdkInstallDir();

    const items: SdkQuickPickItem[] = installed.map(sdk => ({
      label: sdk.name,
      description: sdk.path === active ? "$(check) active" : `v${sdk.version}`,
      detail: sdk.path,
      sdkPath: sdk.path,
      buttons: [uninstallButton],
    }));

    if (installed.length === 0) {
      items.push({ label: "No SDKs installed yet", alwaysShow: true });
    }

    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: "$(cloud-download) Install new SDK…", install: true, alwaysShow: true });

    qp.items = items;
    qp.busy = false;
  };

  // Re-resolve the active SDK after a change to the installed set, rebuilding the
  // environment so PATH / ZEPHYR_SDK_INSTALL_DIR reflect the current selection.
  const reselectActiveSdk = async (removedPath: string): Promise<void> => {
    if (SettingsManager.getSdkInstallDir() !== removedPath) { return; }

    const zephyrBase = SettingsManager.getZephyrBase();
    const required = zephyrBase ? await ManifestValidator.getRequiredSdkVersion(zephyrBase) : undefined;

    let next: string | undefined;
    if (required) {
      next = await ManifestValidator.findCompatibleInstalledSdk(required, removedPath);
    }
    if (!next) {
      next = (await getInstalledSdks())[0]?.path;
    }

    await SettingsManager.setSdkInstallDir(next);
    await PathManager.setupEnvironmentPaths(context, config);
  };

  qp.onDidTriggerItemButton(async (event) => {
    const sdkPath = event.item.sdkPath;
    if (!sdkPath) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Uninstall ${event.item.label}?`,
      { modal: true, detail: sdkPath },
      "Uninstall"
    );
    if (confirm !== "Uninstall") { return; }

    qp.busy = true;
    await fs.remove(sdkPath);
    await reselectActiveSdk(sdkPath);
    await refresh();
    vscode.window.showInformationMessage(`Uninstalled ${event.item.label}.`);
  });

  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0];
    if (!item) { return; }

    if (item.install) {
      qp.hide();
      await installSdkCommand(context);
      return;
    }

    if (item.sdkPath) {
      await SettingsManager.setSdkInstallDir(item.sdkPath);
      await PathManager.setupEnvironmentPaths(context, config);
      vscode.window.showInformationMessage(`Active Zephyr SDK: ${item.label}`);
      qp.hide();
    }
  });

  qp.onDidHide(() => qp.dispose());

  await refresh();
  qp.show();
}

/**
 * Ensures a compatible SDK is available for the current workspace's Zephyr tree,
 * prompting the user to install one if needed.
 *
 * Returns true if a compatible SDK is active (or no Zephyr tree requires one),
 * false if the user declined or installation failed.
 */
export async function ensureCompatibleSdkInteractive(
  context: vscode.ExtensionContext
): Promise<boolean> {
  // checkSdkCompatibility auto-switches to a compatible installed SDK if possible.
  const sdkError = await ManifestValidator.checkSdkCompatibility();
  if (!sdkError) {
    // The active SDK may have been auto-switched here (or by the sidebar's
    // background validation) without updating VS Code's environment variable
    // collection. That collection is persistent and is applied on top of a task's
    // own env, so a stale ZEPHYR_SDK_INSTALL_DIR there would override the correct
    // value in the build task. Resync it before building.
    const config = await GlobalConfigManager.load(context);
    await PathManager.setupEnvironmentPaths(context, config);
    return true;
  }

  // Nothing installed is compatible. Recommend the right manifest SDK to install.
  const zephyrBase = SettingsManager.getZephyrBase();
  const required = zephyrBase ? await ManifestValidator.getRequiredSdkVersion(zephyrBase) : undefined;
  const recommended = required ? recommendSdkForRequired(required) : undefined;

  const installLabel = recommended ? `Install ${recommended.name}` : "Install SDK…";
  const chooseLabel = "Choose Version…";
  const choice = await vscode.window.showWarningMessage(sdkError, installLabel, chooseLabel);

  if (choice === installLabel) {
    return await installSdkCommand(context, recommended?.name);
  }
  if (choice === chooseLabel) {
    return await installSdkCommand(context);
  }
  return false;
}

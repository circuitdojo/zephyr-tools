/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { TOOLS_FOLDER_NAME, getPlatformConfig } from "./constants";
import { EnvironmentUtils } from "../utils/environment-utils";

export class SettingsManager {
  private static readonly CONFIG_SECTION = "zephyr-tools";

  // Resolves the ARM toolchain bin directory inside a Zephyr SDK, accounting for
  // the layout change in SDK 1.0+ (GNU toolchains moved to <sdk>/gnu/<triple>);
  // older SDKs keep them at <sdk>/<triple>.
  static getSdkArmToolchainBin(sdkInstallDir: string): string {
    const gnuPath = path.join(sdkInstallDir, "gnu", "arm-zephyr-eabi", "bin");
    if (fs.existsSync(gnuPath)) {
      return gnuPath;
    }
    return path.join(sdkInstallDir, "arm-zephyr-eabi", "bin");
  }

  static getToolsDirectory(): string {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    const customPath = config.get<string>("paths.toolsDirectory");
    return customPath || this.getDefaultToolsDirectory();
  }

  // Default location for the Zephyr Tools install (SDK, toolchain, host tools).
  // The Zephyr SDK / GNU toolchain cannot tolerate a space in its install path on
  // Windows: GCC emits its built-in library search paths unquoted, so the linker
  // splits the `-L` flag at the space and fails. When the home directory contains
  // a space (e.g. C:\Users\Jared Wolff), fall back to a space-free location at the
  // root of the home drive (e.g. C:\.zephyrtools).
  static getDefaultToolsDirectory(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): string {
    const pathImpl = platform === "win32" ? path.win32 : path.posix;
    if (platform === "win32" && /\s/.test(home)) {
      const root = pathImpl.parse(home).root || "C:\\";
      return pathImpl.join(root, TOOLS_FOLDER_NAME);
    }
    return pathImpl.join(home, TOOLS_FOLDER_NAME);
  }

  // Returns an error message if the given install path is unusable for the Zephyr
  // SDK on the current platform, otherwise undefined. A space anywhere in the path
  // breaks GNU-toolchain linking on Windows; this is a hard toolchain limitation
  // that no SDK version fixes, so we refuse rather than fail cryptically at link.
  static validateToolsDirectory(toolsDir: string, platform: NodeJS.Platform = process.platform): string | undefined {
    if (platform === "win32" && /\s/.test(toolsDir)) {
      return (
        `The Zephyr Tools install path contains a space, which breaks the Zephyr ` +
        `SDK linker on Windows:\n\n  ${toolsDir}\n\n` +
        `Set "zephyr-tools.paths.toolsDirectory" to a space-free path (e.g. ` +
        `C:\\${TOOLS_FOLDER_NAME}) and run Setup again.`
      );
    }
    return undefined;
  }

  static async setToolsDirectory(toolsPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("paths.toolsDirectory", toolsPath, vscode.ConfigurationTarget.Global);
  }

  static getPythonExecutable(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    const customPath = config.get<string>("paths.pythonExecutable");
    return customPath || undefined;
  }

  static async setPythonExecutable(pythonPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("paths.pythonExecutable", pythonPath, vscode.ConfigurationTarget.Global);
  }

  static getZephyrBase(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    const customPath = config.get<string>("paths.zephyrBase");
    return customPath || undefined;
  }

  static async setZephyrBase(zephyrBasePath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    // Use Global scope if no workspace is open, otherwise use Workspace scope
    const target = vscode.workspace.workspaceFolders ? 
      vscode.ConfigurationTarget.Workspace : 
      vscode.ConfigurationTarget.Global;
    await config.update("paths.zephyrBase", zephyrBasePath, target);
  }

  static getWestExecutable(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    const customPath = config.get<string>("paths.westExecutable");
    return customPath || undefined;
  }

  static async setWestExecutable(westPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("paths.westExecutable", westPath, vscode.ConfigurationTarget.Global);
  }

  static getAllPaths(): string[] {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<string[]>("paths.allPaths") || [];
  }

  static async setAllPaths(paths: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("paths.allPaths", paths, vscode.ConfigurationTarget.Global);
  }

  static async addPath(newPath: string): Promise<void> {
    const currentPaths = this.getAllPaths();
    if (!currentPaths.includes(newPath)) {
      await this.setAllPaths([...currentPaths, newPath]);
    }
  }

  static async removePath(pathToRemove: string): Promise<void> {
    const currentPaths = this.getAllPaths();
    const filteredPaths = currentPaths.filter(p => p !== pathToRemove);
    await this.setAllPaths(filteredPaths);
  }

  static getAllConfiguredPaths(): { [key: string]: string | string[] | undefined } {
    return {
      toolsDirectory: this.getToolsDirectory(),
      pythonExecutable: this.getPythonExecutable(),
      zephyrBase: this.getZephyrBase(),
      westExecutable: this.getWestExecutable(),
      allPaths: this.getAllPaths()
    };
  }

  static async detectZephyrBase(): Promise<string | undefined> {
    const fs = await import("fs-extra");
    
    // Check if ZEPHYR_BASE is already configured
    const configured = this.getZephyrBase();
    if (configured) {
      return configured;
    }
    
    // Check workspace folders for a zephyr directory
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const zephyrPath = path.join(folder.uri.fsPath, "zephyr");
        const versionFile = path.join(zephyrPath, "VERSION");
        
        // Check if this looks like a Zephyr installation
        if (await fs.pathExists(versionFile)) {
          return zephyrPath;
        }
      }
    }
    
    return undefined;
  }

  // Environment variable management
  static getEnvironmentVariables(): { [key: string]: string } {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<{ [key: string]: string }>("environment.variables") || {};
  }

  static async setEnvironmentVariables(vars: { [key: string]: string }): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("environment.variables", vars, vscode.ConfigurationTarget.Global);
  }

  static async setEnvironmentVariable(name: string, value: string): Promise<void> {
    const vars = this.getEnvironmentVariables();
    vars[name] = value;
    await this.setEnvironmentVariables(vars);
  }

  static getEnvironmentVariable(name: string): string | undefined {
    const vars = this.getEnvironmentVariables();
    return vars[name];
  }

  // Convenience methods for specific environment variables

  // Workspace-scoped SDK install dir. This is the single source of truth — there is
  // intentionally no fallback to a global env-var, since such a fallback could
  // resurrect an uninstalled SDK after the workspace setting is cleared. Legacy
  // global values are moved into this setting once by migrateLegacySdkInstallDir().
  static getSdkInstallDir(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<string>("paths.sdkInstallDir") || undefined;
  }

  // One-time migration of the legacy global ZEPHYR_SDK_INSTALL_DIR env-var into the
  // workspace-scoped paths.sdkInstallDir setting. Older versions stored the SDK dir
  // in environment.variables, which then acted as a fallback. This adopts that value
  // for the workspace (only if one isn't already chosen) and removes the legacy entry
  // so it can never resurrect a removed SDK.
  static async migrateLegacySdkInstallDir(): Promise<void> {
    const legacy = this.getEnvironmentVariable("ZEPHYR_SDK_INSTALL_DIR");
    if (!legacy) { return; }

    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    if (!config.get<string>("paths.sdkInstallDir")) {
      await this.setSdkInstallDir(legacy);
    }

    const vars = this.getEnvironmentVariables();
    delete vars["ZEPHYR_SDK_INSTALL_DIR"];
    await this.setEnvironmentVariables(vars);
  }

  // Sets the workspace-scoped SDK install dir. Pass undefined to clear it (e.g. when
  // the active SDK has been uninstalled and no replacement is available).
  static async setSdkInstallDir(sdkPath: string | undefined): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    const target = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update("paths.sdkInstallDir", sdkPath || undefined, target);
  }

  static getZephyrSdkInstallDir(): string | undefined {
    return this.getSdkInstallDir();
  }

  static async setZephyrSdkInstallDir(sdkPath: string): Promise<void> {
    await this.setSdkInstallDir(sdkPath);
  }

  static getZephyrToolchainVariant(): string | undefined {
    return this.getEnvironmentVariable("ZEPHYR_TOOLCHAIN_VARIANT");
  }

  static async setZephyrToolchainVariant(variant: string): Promise<void> {
    await this.setEnvironmentVariable("ZEPHYR_TOOLCHAIN_VARIANT", variant);
  }

  static getVirtualEnv(): string | undefined {
    return this.getEnvironmentVariable("VIRTUAL_ENV");
  }

  static async setVirtualEnv(path: string): Promise<void> {
    await this.setEnvironmentVariable("VIRTUAL_ENV", path);
  }

  // Helper to build complete environment for command execution
  static buildEnvironmentForExecution(): { [key: string]: string } {
    // Start with normalized system environment (handles Windows PATH case sensitivity)
    const env = EnvironmentUtils.getSystemEnvironment();
    
    // Add all configured environment variables from settings
    const envVars = this.getEnvironmentVariables();
    for (const [key, value] of Object.entries(envVars)) {
      if (value) {
        env[key] = value;
      }
    }
    
    // Set VIRTUAL_ENV to current tools directory
    const pythonenv = path.join(this.getToolsDirectory(), "env");
    env["VIRTUAL_ENV"] = pythonenv;
    
    // Build PATH with all tool paths
    const allPaths = this.getAllPaths();
    let pathComponents: string[] = [];
    
    // Add Python environment paths first
    pathComponents.push(path.join(pythonenv, "Scripts"));
    pathComponents.push(path.join(pythonenv, "bin"));
    
    // Add all saved tool paths
    pathComponents = pathComponents.concat(allPaths);
    
    // Add existing PATH
    if (env.PATH) {
      pathComponents.push(env.PATH);
    }
    
    // Join path components with platform-appropriate separator
    const platformConfig = getPlatformConfig();
    env.PATH = pathComponents.filter(p => p).join(platformConfig.pathDivider);

    // Inject workspace-scoped SDK dir and prepend its ARM toolchain path.
    // getSdkInstallDir() reads the workspace setting first, so this correctly
    // overrides the legacy global env-var value when both are present.
    const sdkDir = this.getSdkInstallDir();
    if (sdkDir) {
      env["ZEPHYR_SDK_INSTALL_DIR"] = sdkDir;
      const armPath = this.getSdkArmToolchainBin(sdkDir);
      env.PATH = armPath + platformConfig.pathDivider + env.PATH;
    }

    return env;
  }

  // probe-rs specific settings
  static getProbeRsChipName(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<string>("probeRs.chipName") || undefined;
  }

  static async setProbeRsChipName(chipName: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("probeRs.chipName", chipName, vscode.ConfigurationTarget.Workspace);
  }

  static getProbeRsProbeId(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<string>("probeRs.probeId") || undefined;
  }

  static async setProbeRsProbeId(probeId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("probeRs.probeId", probeId, vscode.ConfigurationTarget.Workspace);
  }

  static getProbeRsPreverify(): boolean {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<boolean>("probeRs.preverify") || false;
  }

  static async setProbeRsPreverify(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("probeRs.preverify", enabled, vscode.ConfigurationTarget.Workspace);
  }

  static getProbeRsVerify(): boolean {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<boolean>("probeRs.verify") || false;
  }

  static async setProbeRsVerify(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("probeRs.verify", enabled, vscode.ConfigurationTarget.Workspace);
  }

  // Serial port settings
  static getSerialPort(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<string>("serial.port") || undefined;
  }

  static async setSerialPort(port: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("serial.port", port, vscode.ConfigurationTarget.Workspace);
  }

  static getSerialSaveLogsToFile(): boolean {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<boolean>("serial.saveLogsToFile") || false;
  }

  static async setSerialSaveLogsToFile(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("serial.saveLogsToFile", enabled, vscode.ConfigurationTarget.Workspace);
  }

  // Recovery tool settings
  static getRecoveryPath(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<string>("recovery.path") || undefined;
  }

  static async setRecoveryPath(recoveryPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("recovery.path", recoveryPath, vscode.ConfigurationTarget.Global);
  }

  // Newtmgr settings
  static getNewtmgrBaudRate(): number {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    return config.get<number>("newtmgr.baudRate") || 1000000;
  }

  static async setNewtmgrBaudRate(baudRate: number): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update("newtmgr.baudRate", baudRate, vscode.ConfigurationTarget.Workspace);
  }

}
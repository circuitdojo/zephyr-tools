/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { TOOLS_FOLDER_NAME, getPlatformConfig } from "./constants";

export class SettingsManager {
  private static readonly CONFIG_SECTION = "zephyr-tools";

  static getToolsDirectory(): string {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    const customPath = config.get<string>("paths.toolsDirectory");
    return customPath || path.join(os.homedir(), TOOLS_FOLDER_NAME);
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
  static getZephyrSdkInstallDir(): string | undefined {
    return this.getEnvironmentVariable("ZEPHYR_SDK_INSTALL_DIR");
  }

  static async setZephyrSdkInstallDir(path: string): Promise<void> {
    await this.setEnvironmentVariable("ZEPHYR_SDK_INSTALL_DIR", path);
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
    // Start with system environment
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    
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

}
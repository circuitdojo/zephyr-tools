/**
 * @file path-manager.ts
 * Handles environment path modifications for the Zephyr Tools.
 * 
 * @license Apache-2.0
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getPlatformConfig } from '../config';
import { SettingsManager } from '../config/settings-manager';
import { GlobalConfig } from '../types';

export class PathManager {
  static async restorePaths(config: GlobalConfig, context: vscode.ExtensionContext): Promise<void> {
    const platformConfig = getPlatformConfig();
    const pathDivider = platformConfig.pathDivider;

    if (config.isSetup) {
      try {
        // Get all paths from settings
        const allPaths = SettingsManager.getAllPaths();
        
        // If no paths are saved, try to build them from standard locations
        if (allPaths.length === 0) {
          const toolsDirectory = SettingsManager.getToolsDirectory();
          const standardPaths = await this.getStandardToolPaths(toolsDirectory);
          
          // Save the discovered paths
          if (standardPaths.length > 0) {
            await SettingsManager.setAllPaths(standardPaths);
          }
          
          // Use the discovered paths
          for (const pathToAdd of standardPaths) {
            if (pathToAdd && pathToAdd.trim()) {
              context.environmentVariableCollection.prepend("PATH", pathToAdd + pathDivider);
            }
          }
        } else {
          // Use the saved paths
          for (const pathToAdd of allPaths) {
            if (pathToAdd && pathToAdd.trim()) {
              context.environmentVariableCollection.prepend("PATH", pathToAdd + pathDivider);
            }
          }
        }
      } catch (error) {
        console.log('Warning: Failed to restore paths:', error);
        // Don't throw - extension should still activate
      }
    }
  }

  private static async getStandardToolPaths(toolsDirectory: string): Promise<string[]> {
    const paths: string[] = [];
    const fs = await import("fs-extra");
    
    try {
      // Check if tools directory exists
      if (await fs.pathExists(toolsDirectory)) {
        // Get all subdirectories in tools directory
        const entries = await fs.readdir(toolsDirectory, { withFileTypes: true });
        const toolDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        
        // Standard Python virtual environment path
        const pythonEnvPath = path.join(toolsDirectory, "env");
        if (await fs.pathExists(pythonEnvPath)) {
          const binPath = path.join(pythonEnvPath, process.platform === "win32" ? "Scripts" : "bin");
          if (await fs.pathExists(binPath)) {
            paths.push(binPath);
          }
        }
        
        // Check each tool directory for executable paths
        for (const toolDir of toolDirs) {
          if (toolDir === "env") {continue;} // Already handled above
          
          const toolPath = path.join(toolsDirectory, toolDir);
          
          // Common patterns for tool executable locations
          const possibleBinPaths = [
            toolPath, // Root directory (ninja, newtmgr, etc.)
            path.join(toolPath, "bin"), // Standard bin subdirectory
          ];
          
          // Check for Zephyr SDK toolchain paths
          if (toolDir.startsWith("zephyr-sdk-")) {
            possibleBinPaths.push(
              path.join(toolPath, "arm-zephyr-eabi", "bin"),
              path.join(toolPath, "riscv64-zephyr-elf", "bin"),
              path.join(toolPath, "xtensa-espressif_esp32_zephyr-elf", "bin")
            );
          }
          
          // Check each possible path and add if it exists and contains executables
          for (const binPath of possibleBinPaths) {
            try {
              if (await fs.pathExists(binPath)) {
                const stat = await fs.stat(binPath);
                if (stat.isDirectory()) {
                  // Check if directory contains executable files
                  const files = await fs.readdir(binPath);
                  const hasExecutables = files.some((file: string) => 
                    file.endsWith('.exe') || 
                    file.includes('gcc') || 
                    file.includes('cmake') || 
                    file.includes('ninja') ||
                    file.includes('probe-rs') ||
                    file.includes('newtmgr') ||
                    file.includes('zephyr-tools')
                  );
                  if (hasExecutables) {
                    paths.push(binPath);
                  }
                }
              }
            } catch (_error) {
              // Ignore errors for individual paths
              continue;
            }
          }
        }
      }
    } catch (_error) {
      // If scanning fails, fall back to basic Python env path only
      const pythonEnvPath = path.join(toolsDirectory, "env");
      const binPath = path.join(pythonEnvPath, process.platform === "win32" ? "Scripts" : "bin");
      paths.push(binPath);
    }
    
    return paths;
  }

  static async setupEnvironmentPaths(context: vscode.ExtensionContext, _config: GlobalConfig): Promise<void> {
    // Restore global environment variables from settings, but let the
    // workspace-scoped SDK setting take precedence (handled below).
    const envVars = SettingsManager.getEnvironmentVariables();
    for (const [key, value] of Object.entries(envVars)) {
      if (value && key !== "ZEPHYR_SDK_INSTALL_DIR") {
        context.environmentVariableCollection.replace(key, value);
      }
    }

    // VIRTUAL_ENV should be based on current tools directory
    const pythonenv = path.join(SettingsManager.getToolsDirectory(), "env");
    context.environmentVariableCollection.replace("VIRTUAL_ENV", pythonenv);

    // Apply the workspace-scoped SDK install dir and its ARM toolchain path.
    //
    // The env collection allows only ONE mutator per variable, so each prepend to
    // PATH overwrites the previous one. We therefore rebuild PATH as a single
    // mutator combining the saved tool paths with the active SDK's toolchain, and
    // explicitly delete the SDK entries when no SDK is selected. Without this an
    // uninstalled/switched-away SDK would linger in PATH and ZEPHYR_SDK_INSTALL_DIR.
    const pathDivider = getPlatformConfig().pathDivider;
    const sdkInstallDir = SettingsManager.getSdkInstallDir();

    const pathEntries: string[] = [];
    if (sdkInstallDir) {
      pathEntries.push(SettingsManager.getSdkArmToolchainBin(sdkInstallDir));
    }
    pathEntries.push(...SettingsManager.getAllPaths());

    const pathPrefix = pathEntries.filter(p => p && p.trim()).join(pathDivider);
    if (pathPrefix) {
      context.environmentVariableCollection.prepend("PATH", pathPrefix + pathDivider);
    } else {
      context.environmentVariableCollection.delete("PATH");
    }

    if (sdkInstallDir) {
      context.environmentVariableCollection.replace("ZEPHYR_SDK_INSTALL_DIR", sdkInstallDir);
    } else {
      context.environmentVariableCollection.delete("ZEPHYR_SDK_INSTALL_DIR");
    }
  }
}


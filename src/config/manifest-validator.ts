/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import * as cp from "child_process";
import { GlobalConfig, Manifest, ManifestEntry, ManifestDownloadEntry } from "../types";
import { toolsDir, arch, platform, pathdivider } from "../config";

export interface ManifestValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingComponents: string[];
}

/**
 * Comprehensive manifest validation that verifies physical presence
 * of all tools and dependencies specified in the manifest
 */
export class ManifestValidator {
  private static manifest: Manifest = require("../../manifest/manifest.json");

  /**
   * Validates the entire setup against the current manifest
   */
  static async validateCompleteSetup(config: GlobalConfig): Promise<ManifestValidationResult> {
    const result: ManifestValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      missingComponents: []
    };

    // Check manifest version first
    if (config.manifestVersion !== this.manifest.version) {
      result.isValid = false;
      result.errors.push(`Manifest version mismatch. Expected ${this.manifest.version}, got ${config.manifestVersion}`);
      return result;
    }

    // Get platform-specific manifest
    const platformManifest = this.getPlatformManifest();
    if (!platformManifest) {
      result.isValid = false;
      result.errors.push(`Unsupported platform: ${platform}-${arch}`);
      return result;
    }

    // Find the architecture entry
    const archEntry = platformManifest.find(entry => entry.arch === arch);
    if (!archEntry) {
      result.isValid = false;
      result.errors.push(`Unsupported architecture: ${arch} for platform ${platform}`);
      return result;
    }

    // Validate core dependencies
    await this.validateDependencies(archEntry.downloads, config, result);

    // Validate toolchain (need to determine which was installed)
    await this.validateInstalledToolchain(archEntry, config, result);

    // Validate environment variables
    this.validateEnvironmentVariables(config, result);

    // Validate PATH modifications
    await this.validatePathModifications(config, result);

    return result;
  }

  /**
   * Validates that all required dependencies are physically present
   */
  private static async validateDependencies(
    downloads: ManifestDownloadEntry[],
    config: GlobalConfig,
    result: ManifestValidationResult
  ): Promise<void> {
    for (const download of downloads) {
      await this.validateSingleDependency(download, config, result);
    }
  }

  /**
   * Validates a single dependency from the manifest
   */
  private static async validateSingleDependency(
    download: ManifestDownloadEntry,
    config: GlobalConfig,
    result: ManifestValidationResult
  ): Promise<void> {
    const componentName = download.name;
    
    // Calculate expected installation path
    let installPath = path.join(toolsDir, download.name);
    if (download.copy_to_subfolder) {
      installPath = path.join(installPath, download.copy_to_subfolder);
    }

    // Check if directory exists
    const exists = await fs.pathExists(installPath);
    if (!exists) {
      result.isValid = false;
      result.errors.push(`Missing component: ${componentName} (expected at ${installPath})`);
      result.missingComponents.push(componentName);
      return;
    }

    // Check if directory is not empty
    try {
      const contents = await fs.readdir(installPath);
      if (contents.length === 0) {
        result.isValid = false;
        result.errors.push(`Empty installation directory for ${componentName}: ${installPath}`);
        result.missingComponents.push(componentName);
        return;
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Cannot read installation directory for ${componentName}: ${error}`);
      result.missingComponents.push(componentName);
      return;
    }

    // Validate executable is functional (for tools with executables)
    await this.validateExecutable(download, installPath, result);

    // Validate environment variables for this component
    if (download.env) {
      for (const envEntry of download.env) {
        const expectedValue = this.calculateExpectedEnvValue(envEntry, installPath);
        const actualValue = config.env[envEntry.name];
        
        if (expectedValue && actualValue !== expectedValue) {
          result.warnings.push(`Environment variable ${envEntry.name} mismatch. Expected: ${expectedValue}, Actual: ${actualValue}`);
        }
      }
    }
  }

  /**
   * Validates that an executable tool is functional
   */
  private static async validateExecutable(
    download: ManifestDownloadEntry,
    installPath: string,
    result: ManifestValidationResult
  ): Promise<void> {
    const toolName = download.name;
    
    // Define executable names for different tools
    const executableMap: { [key: string]: string[] } = {
      'cmake': ['cmake', 'cmake.exe'],
      'ninja': ['ninja', 'ninja.exe'],
      'newtmgr': ['newtmgr', 'newtmgr.exe'],
      'probe-rs': ['probe-rs', 'probe-rs.exe'],
      'zephyr-tools': ['zephyr-tools', 'zephyr-tools.exe']
    };

    const possibleExecutables = executableMap[toolName];
    if (!possibleExecutables) {
      // Skip validation for tools without known executables
      return;
    }

    let executableFound = false;
    let executablePath = '';

    // Check for executable in the install path and suffix path
    const searchPaths = [installPath];
    if (download.suffix) {
      searchPaths.push(path.join(installPath, download.suffix));
    }

    for (const searchPath of searchPaths) {
      for (const execName of possibleExecutables) {
        const fullPath = path.join(searchPath, execName);
        if (await fs.pathExists(fullPath)) {
          executableFound = true;
          executablePath = fullPath;
          break;
        }
      }
      if (executableFound) break;
    }

    if (!executableFound) {
      result.warnings.push(`Executable not found for ${toolName} in ${installPath}`);
      return;
    }

    // Try to run the executable to verify it works
    try {
      await this.testExecutable(executablePath, toolName);
    } catch (error) {
      result.warnings.push(`Executable ${toolName} failed to run: ${error}`);
    }
  }

  /**
   * Tests if an executable runs successfully
   */
  private static async testExecutable(executablePath: string, toolName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Define test commands for different tools
      const testCommands: { [key: string]: string[] } = {
        'cmake': ['--version'],
        'ninja': ['--version'],
        'newtmgr': ['--help'],
        'probe-rs': ['--version'],
        'zephyr-tools': ['--version']
      };

      const args = testCommands[toolName] || ['--version'];
      const process = cp.spawn(executablePath, args, { 
        stdio: 'pipe',
        timeout: 5000 // 5 second timeout
      });

      let hasResponded = false;

      process.on('exit', (code) => {
        if (!hasResponded) {
          hasResponded = true;
          // Most tools return 0 for version/help, but some might return non-zero
          // We consider it working if it exits cleanly (doesn't crash)
          resolve();
        }
      });

      process.on('error', (error) => {
        if (!hasResponded) {
          hasResponded = true;
          reject(error);
        }
      });

      // Kill process after timeout
      setTimeout(() => {
        if (!hasResponded) {
          hasResponded = true;
          process.kill();
          reject(new Error('Executable test timed out'));
        }
      }, 5000);
    });
  }

  /**
   * Validates the installed toolchain matches expected configuration
   */
  private static async validateInstalledToolchain(
    archEntry: ManifestEntry,
    config: GlobalConfig,
    result: ManifestValidationResult
  ): Promise<void> {
    // Check for SDK environment variable to determine which toolchain is installed
    const sdkInstallDir = config.env['ZEPHYR_SDK_INSTALL_DIR'];
    const toolchainVariant = config.env['ZEPHYR_TOOLCHAIN_VARIANT'];

    if (!sdkInstallDir || !toolchainVariant) {
      result.warnings.push('Toolchain environment variables not found. Toolchain may not be properly configured.');
      return;
    }

    // Verify SDK directory exists
    if (!(await fs.pathExists(sdkInstallDir))) {
      result.isValid = false;
      result.errors.push(`Zephyr SDK directory not found: ${sdkInstallDir}`);
      result.missingComponents.push('toolchain');
      return;
    }

    // Check for ARM toolchain specifically (most common)
    const armToolchainPath = path.join(sdkInstallDir, 'arm-zephyr-eabi', 'bin');
    if (!(await fs.pathExists(armToolchainPath))) {
      result.warnings.push(`ARM toolchain directory not found: ${armToolchainPath}`);
    }
  }

  /**
   * Validates environment variables are correctly set
   */
  private static validateEnvironmentVariables(
    config: GlobalConfig,
    result: ManifestValidationResult
  ): void {
    const requiredEnvVars = [
      'ZEPHYR_TOOLCHAIN_VARIANT',
      'ZEPHYR_SDK_INSTALL_DIR'
    ];

    for (const envVar of requiredEnvVars) {
      if (!config.env[envVar]) {
        result.warnings.push(`Missing environment variable: ${envVar}`);
      }
    }

    // Validate PATH contains expected directories
    const pathEnv = config.env['PATH'];
    if (!pathEnv || !pathEnv.includes(toolsDir)) {
      result.warnings.push('PATH does not contain tools directory');
    }
  }

  /**
   * Validates PATH modifications are still active
   */
  private static async validatePathModifications(
    config: GlobalConfig,
    result: ManifestValidationResult
  ): Promise<void> {
    // Check if tools are accessible in PATH
    const criticalTools = ['cmake', 'ninja', 'west'];
    
    for (const tool of criticalTools) {
      try {
        // Try to find the tool in PATH
        const process = cp.spawn(tool, ['--version'], { 
          stdio: 'pipe',
          timeout: 3000,
          env: config.env
        });
        
        await new Promise<void>((resolve, reject) => {
          let resolved = false;
          process.on('exit', () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          });
          process.on('error', (error) => {
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          });
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              process.kill();
              reject(new Error('Timeout'));
            }
          }, 3000);
        });
      } catch (error) {
        result.warnings.push(`Tool ${tool} not accessible in PATH: ${error}`);
      }
    }
  }

  /**
   * Calculate expected environment variable value
   */
  private static calculateExpectedEnvValue(envEntry: any, installPath: string): string | undefined {
    if (envEntry.value) {
      return envEntry.value;
    } else if (envEntry.usepath && !envEntry.append) {
      return path.join(installPath, envEntry.suffix || "");
    } else if (envEntry.usepath && envEntry.append) {
      return path.join(installPath, envEntry.suffix || "") + pathdivider + (process.env[envEntry.name] || "");
    }
    return undefined;
  }

  /**
   * Get platform-specific manifest entries
   */
  private static getPlatformManifest(): ManifestEntry[] | undefined {
    switch (platform) {
      case "darwin":
        return this.manifest.darwin;
      case "linux":
        return this.manifest.linux;
      case "win32":
        return this.manifest.win32;
      default:
        return undefined;
    }
  }

  /**
   * Quick validation check - lighter weight than full validation
   */
  static async quickValidation(config: GlobalConfig): Promise<boolean> {
    // Check manifest version
    if (config.manifestVersion !== this.manifest.version) {
      return false;
    }

    // Check if tools directory exists
    if (!(await fs.pathExists(toolsDir))) {
      return false;
    }

    // Check for key tools
    const keyTools = ['cmake', 'ninja'];
    for (const tool of keyTools) {
      const toolPath = path.join(toolsDir, tool);
      if (!(await fs.pathExists(toolPath))) {
        return false;
      }
    }

    return true;
  }
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs-extra";
import * as path from "path";
import * as cp from "child_process";
import { GlobalConfig, Manifest, ManifestEntry, ManifestDownloadEntry, ManifestEnvEntry } from "../types";
import { arch, platform, pathdivider, SettingsManager } from "../config";

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    let installPath = path.join(SettingsManager.getToolsDirectory(), download.name);
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
        const actualValue = SettingsManager.getEnvironmentVariable(envEntry.name);
        
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
      if (executableFound) {break;}
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

      process.on('exit', (_code) => {
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
    // Resolve the SDK for this workspace's Zephyr tree first. This auto-switches
    // the workspace's selected SDK to a compatible installed version when needed,
    // so the directory checks below operate on the correct (switched) SDK.
    const sdkError = await ManifestValidator.checkSdkCompatibility();
    if (sdkError) {
      result.isValid = false;
      result.errors.push(sdkError);
    }

    // Check for SDK environment variable to determine which toolchain is installed
    const sdkInstallDir = SettingsManager.getZephyrSdkInstallDir();
    const toolchainVariant = SettingsManager.getZephyrToolchainVariant();

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
    if (!SettingsManager.getEnvironmentVariable('ZEPHYR_TOOLCHAIN_VARIANT')) {
      result.warnings.push('Missing environment variable: ZEPHYR_TOOLCHAIN_VARIANT');
    }
    // ZEPHYR_SDK_INSTALL_DIR is workspace-scoped (paths.sdkInstallDir) — read via getSdkInstallDir
    if (!SettingsManager.getSdkInstallDir()) {
      result.warnings.push('Missing environment variable: ZEPHYR_SDK_INSTALL_DIR');
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
          env: SettingsManager.buildEnvironmentForExecution()
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
  private static calculateExpectedEnvValue(envEntry: ManifestEnvEntry, installPath: string): string | undefined {
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
    const toolsDirectory = SettingsManager.getToolsDirectory();
    if (!(await fs.pathExists(toolsDirectory))) {
      return false;
    }

    // Check for key tools
    const keyTools = ['cmake', 'ninja'];
    for (const tool of keyTools) {
      const toolPath = path.join(toolsDirectory, tool);
      if (!(await fs.pathExists(toolPath))) {
        return false;
      }
    }

    return true;
  }

  // Ensures the workspace's selected SDK is compatible with the current Zephyr tree.
  // If the selected SDK is missing or incompatible, this auto-switches the workspace
  // setting to a compatible installed SDK (multiple SDK versions coexist under the
  // toolchain directory). Returns an error message only if no compatible SDK is
  // installed, or undefined if everything is OK / settings aren't configured yet.
  static async checkSdkCompatibility(): Promise<string | undefined> {
    const zephyrBase = SettingsManager.getZephyrBase();
    if (!zephyrBase) { return undefined; }

    const required = await ManifestValidator.getRequiredSdkVersion(zephyrBase);
    if (!required) { return undefined; }

    const sdkInstallDir = SettingsManager.getZephyrSdkInstallDir();

    // If the currently-selected SDK is present and compatible, nothing to do.
    if (sdkInstallDir && (await ManifestValidator.isSdkCompatible(sdkInstallDir, required))) {
      return undefined;
    }

    // The selected SDK is missing or incompatible. Try to auto-switch to a
    // compatible installed SDK before reporting an error.
    const compatible = await ManifestValidator.findCompatibleInstalledSdk(required, sdkInstallDir);
    if (compatible) {
      await SettingsManager.setSdkInstallDir(compatible);
      return undefined;
    }

    // No compatible SDK is installed — surface an actionable error.
    if (!sdkInstallDir) {
      return `Zephyr SDK not configured for this workspace, and no compatible SDK is installed for Zephyr >= ${required}. Run setup to install it.`;
    }

    const installed = await ManifestValidator.getInstalledSdkVersion(sdkInstallDir);
    if (!installed) {
      return `Zephyr SDK not found at configured path: ${sdkInstallDir}. Run setup to install the correct SDK.`;
    }

    return `Zephyr SDK version mismatch: installed ${installed}, but this Zephyr requires >= ${required}. No compatible SDK is installed — run setup to install it.`;
  }

  // Returns true if the SDK at the given path is installed and compatible with the
  // requested Zephyr SDK version (accounting for the SDK's own minimum-compatible floor).
  private static async isSdkCompatible(sdkInstallDir: string, required: string): Promise<boolean> {
    const installed = await ManifestValidator.getInstalledSdkVersion(sdkInstallDir);
    if (!installed) { return false; }
    const minimumCompatible = await ManifestValidator.getSdkMinimumCompatibleVersion(sdkInstallDir);
    return ManifestValidator.sdkVersionSatisfies(installed, required, minimumCompatible);
  }

  // Scans the directory holding installed SDKs (siblings of the current SDK, or the
  // manifest's toolchain directory) and returns the path of the highest-version SDK
  // compatible with the requested Zephyr SDK version, or undefined if none qualify.
  static async findCompatibleInstalledSdk(
    required: string,
    currentSdkInstallDir?: string
  ): Promise<string | undefined> {
    // Installed SDKs live as `zephyr-sdk-<version>` siblings of the selected SDK.
    const searchDir = currentSdkInstallDir
      ? path.dirname(currentSdkInstallDir)
      : path.join(SettingsManager.getToolsDirectory(), 'toolchain');

    if (!(await fs.pathExists(searchDir))) { return undefined; }

    const entries = await fs.readdir(searchDir);
    const candidates: { path: string; version: string }[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('zephyr-sdk-')) { continue; }
      const candidatePath = path.join(searchDir, entry);
      const installed = await ManifestValidator.getInstalledSdkVersion(candidatePath);
      if (!installed) { continue; }
      const minimumCompatible = await ManifestValidator.getSdkMinimumCompatibleVersion(candidatePath);
      if (ManifestValidator.sdkVersionSatisfies(installed, required, minimumCompatible)) {
        candidates.push({ path: candidatePath, version: installed });
      }
    }

    if (candidates.length === 0) { return undefined; }

    // Prefer the highest compatible installed version.
    candidates.sort((a, b) => ManifestValidator.compareSdkVersions(b.version, a.version));
    return candidates[0].path;
  }

  // Compares two full SDK version strings (major.minor.patch). Returns a positive
  // number if a > b, negative if a < b, and 0 if equal.
  private static compareSdkVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) { return diff; }
    }
    return 0;
  }

  static async getRequiredSdkVersion(zephyrBase: string): Promise<string | undefined> {
    const cmakePath = path.join(zephyrBase, 'cmake', 'modules', 'FindHostTools.cmake');
    if (!(await fs.pathExists(cmakePath))) { return undefined; }
    const content = await fs.readFile(cmakePath, 'utf-8');
    return content.match(/find_package\s*\(\s*Zephyr-sdk\s+([\d.]+)/)?.[1];
  }

  static async getInstalledSdkVersion(sdkInstallDir: string): Promise<string | undefined> {
    const versionPath = path.join(sdkInstallDir, 'sdk_version');
    if (!(await fs.pathExists(versionPath))) { return undefined; }
    return (await fs.readFile(versionPath, 'utf-8')).trim();
  }

  // Reads ZEPHYR_SDK_MINIMUM_COMPATIBLE_VERSION from the SDK's own version config.
  // This is the minimum Zephyr-requested version the SDK will accept (SDK 1.0 sets this to 1.0,
  // explicitly refusing to serve older Zephyr trees that ask for 0.x).
  static async getSdkMinimumCompatibleVersion(sdkInstallDir: string): Promise<string | undefined> {
    const configVersionPath = path.join(sdkInstallDir, 'cmake', 'Zephyr-sdkConfigVersion.cmake');
    if (!(await fs.pathExists(configVersionPath))) { return undefined; }
    const content = await fs.readFile(configVersionPath, 'utf-8');
    return content.match(/set\s*\(\s*ZEPHYR_SDK_MINIMUM_COMPATIBLE_VERSION\s+([\d.]+)/)?.[1];
  }

  // Returns true if the installed SDK is compatible with the requested version.
  // Accounts for the SDK's own MINIMUM_COMPATIBLE_VERSION floor (SDK 1.0 rejects requests < 1.0).
  static sdkVersionSatisfies(installed: string, required: string, minimumCompatible?: string): boolean {
    const parse = (v: string): [number, number] => {
      const [major = 0, minor = 0] = v.split('.').map(Number);
      return [major, minor];
    };
    const cmp = ([aMaj, aMin]: [number, number], [bMaj, bMin]: [number, number]): number =>
      aMaj !== bMaj ? aMaj - bMaj : aMin - bMin;

    const req = parse(required);
    if (minimumCompatible && cmp(req, parse(minimumCompatible)) < 0) {
      return false;
    }
    return cmp(parse(installed), req) >= 0;
  }
}

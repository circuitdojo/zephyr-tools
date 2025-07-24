/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import { platform } from "../config";

export interface PlatformPaths {
  pythonExecutable: string;
  pathDivider: string;
  whichCommand: string;
}

export class PlatformUtils {
  static getPlatformSpecificPaths(): PlatformPaths {
    switch (platform) {
      case "win32":
        return {
          pythonExecutable: "python",
          pathDivider: ";",
          whichCommand: "where"
        };
      default:
        return {
          pythonExecutable: "python3",
          pathDivider: ":",
          whichCommand: "which"
        };
    }
  }

  static isWindows(): boolean {
    return platform === "win32";
  }

  static getExecutableExtension(): string {
    return this.isWindows() ? ".exe" : "";
  }

  static normalizePathForPlatform(inputPath: string): string {
    if (this.isWindows()) {
      return inputPath.replace(/\//g, "\\");
    } else {
      return inputPath.replace(/\\/g, "/");
    }
  }

  /**
   * Get platform-specific executable names for tools used by Zephyr Tools
   */
  static getToolExecutables() {
    return {
      probeRs: `probe-rs${this.getExecutableExtension()}`,
      newtmgr: `newtmgr${this.getExecutableExtension()}`,
      zephyrTools: `zephyr-tools${this.getExecutableExtension()}`
    };
  }
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as os from "os";
import * as path from "path";

// Platform
export const platform: NodeJS.Platform = os.platform();

// Architecture
export const arch: string = os.arch();

// Platform-dependent variables
export const TOOLS_FOLDER_NAME = ".zephyrtools";
export const BAUD_LIST = ["1000000", "115200"];

// Platform-specific configurations
export interface PlatformConfig {
  python: string;
  pathDivider: string;
  which: string;
}

export function getPlatformConfig(): PlatformConfig {
  switch (platform) {
    case "win32":
      return {
        python: "python",
        pathDivider: ";",
        which: "where"
      };
    default:
      return {
        python: "python3",
        pathDivider: ":",
        which: "which"
      };
  }
}

// Important directories
export const toolsDir = path.join(os.homedir(), TOOLS_FOLDER_NAME);

// Path divider for the current platform
export const pathdivider = getPlatformConfig().pathDivider;

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as util from "util";
import * as cp from "child_process";
import { GlobalConfig } from "../types";
import { OutputChannelManager } from "../ui";
import { PlatformUtils } from "../utils";

/**
 * Manages newtmgr connection profiles and operations
 */
export class NewtmgrManager {
  private static readonly PROFILE_NAME = "vscode-zephyr-tools";

  /**
   * Sets up a newtmgr serial connection profile
   */
  static async setupConnection(
    config: GlobalConfig,
    port: string,
    baud: string
  ): Promise<boolean> {
    const exec = util.promisify(cp.exec);
    
    try {
      const tools = PlatformUtils.getToolExecutables();
      const cmd = `${tools.newtmgr} conn add ${this.PROFILE_NAME} type=serial connstring="dev=${port},baud=${baud}"`;
      const result = await exec(cmd, { env: config.env });
      
      if (result.stderr) {
        const output = OutputChannelManager.getChannel();
        output.append(result.stderr);
        output.show();
        return false;
      }
      
      return true;
    } catch (error) {
      console.error("Newtmgr setup connection error:", error);
      return false;
    }
  }

  /**
   * Verifies that the newtmgr connection profile exists
   */
  static async verifyConnection(config: GlobalConfig): Promise<boolean> {
    const exec = util.promisify(cp.exec);
    
    try {
      const tools = PlatformUtils.getToolExecutables();
      const cmd = `${tools.newtmgr} conn show`;
      const result = await exec(cmd, { env: config.env });
      
      if (result.stderr) {
        const output = OutputChannelManager.getChannel();
        output.append(result.stderr);
        output.show();
        return false;
      }
      
      return result.stdout.includes(this.PROFILE_NAME);
    } catch (error) {
      console.error("Newtmgr verify connection error:", error);
      return false;
    }
  }

  /**
   * Checks if the vscode-zephyr-tools profile is configured
   */
  static async isProfileConfigured(config: GlobalConfig): Promise<boolean> {
    return this.verifyConnection(config);
  }

  /**
   * Checks if newtmgr is installed and available
   */
  static async isInstalled(config: GlobalConfig): Promise<boolean> {
    const exec = util.promisify(cp.exec);
    
    try {
      const tools = PlatformUtils.getToolExecutables();
      await exec(`${tools.newtmgr} version`, { env: config.env });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets the profile name used by the extension
   */
  static getProfileName(): string {
    return this.PROFILE_NAME;
  }
}

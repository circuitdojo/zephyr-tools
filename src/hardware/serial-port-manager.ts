/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as util from "util";
import * as cp from "child_process";
import { BAUD_LIST } from "../config";
import { DialogManager } from "../ui";
import { GlobalConfig } from "../types";

export class SerialPortManager {
  static async getAvailablePorts(config: GlobalConfig): Promise<string[]> {
    const exec = util.promisify(cp.exec);

    try {
      // Get list of ports using zephyr-tools
      const cmd = "zephyr-tools -l";
      const result = await exec(cmd, { env: config.env });
      
      if (result.stderr) {
        console.error("Error getting ports:", result.stderr);
        return [];
      }

      const ports = JSON.parse(result.stdout);
      return Array.isArray(ports) ? ports : [];
    } catch (error) {
      console.error("Failed to get available ports:", error);
      return [];
    }
  }

  static async selectPort(config: GlobalConfig): Promise<string | undefined> {
    // Check if setup has been run
    if (!config.isSetup) {
      vscode.window.showErrorMessage("Please run 'Zephyr Tools: Setup' command before selecting a serial port.");
      return undefined;
    }

    const ports = await this.getAvailablePorts(config);
    
    if (ports.length === 0) {
      vscode.window.showErrorMessage("No serial ports found. Make sure the zephyr-tools CLI is properly installed and in your PATH.");
      return undefined;
    }

    const selectedPort = await DialogManager.selectSerialPort(ports);
    
    if (!selectedPort) {
      vscode.window.showErrorMessage("Invalid port choice.");
      return undefined;
    }

    return selectedPort;
  }

  static async selectBaudRate(defaultBaud?: string): Promise<string | undefined> {
    const selectedBaud = await DialogManager.selectBaudRate(BAUD_LIST, defaultBaud);
    
    if (!selectedBaud || selectedBaud === "") {
      vscode.window.showErrorMessage("Invalid baud rate choice.");
      return undefined;
    }

    return selectedBaud;
  }
}

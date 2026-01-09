/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { getZephyrTerminalOptions } from "../commands/terminal";
import { GlobalConfig } from "../types";

/**
 * Terminal profile provider for Zephyr development environment.
 * This allows users to select "Zephyr Terminal" from the terminal dropdown.
 */
export class ZephyrTerminalProfileProvider implements vscode.TerminalProfileProvider {
  constructor(private config: GlobalConfig) {}

  provideTerminalProfile(
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TerminalProfile> {
    // Check if setup is complete
    if (!this.config.isSetup) {
      vscode.window.showErrorMessage(
        "Zephyr Tools not set up. Run 'Zephyr Tools: Setup' command first."
      );
      return undefined;
    }

    // Get terminal options from the shared function
    const options = getZephyrTerminalOptions();
    if (!options) {
      vscode.window.showErrorMessage("Failed to configure Zephyr terminal environment");
      return undefined;
    }

    // Return a terminal profile
    return new vscode.TerminalProfile(options);
  }
}

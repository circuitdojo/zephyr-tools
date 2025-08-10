/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import { GlobalConfig } from "../types";
import { toolsDir, getPlatformConfig } from "../config";

export async function openZephyrTerminalCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  const pythonenv = path.join(toolsDir, "env");
  const platformConfig = getPlatformConfig();
  const pathDivider = platformConfig.pathDivider;
  
  // Create environment with Python virtual environment activated
  const terminalEnv = { ...config.env };
  
  // Set VIRTUAL_ENV path
  terminalEnv["VIRTUAL_ENV"] = pythonenv;
  
  // Prepend Python environment paths to PATH
  const scriptsPath = path.join(pythonenv, "Scripts");
  const binPath = path.join(pythonenv, "bin");
  
  // Add both Scripts (Windows) and bin (Unix) paths - one will be ignored depending on platform
  terminalEnv["PATH"] = `${scriptsPath}${pathDivider}${binPath}${pathDivider}${terminalEnv["PATH"]}`;

  // Create terminal with the configured environment
  const terminal = vscode.window.createTerminal({
    name: "Zephyr Terminal",
    env: terminalEnv,
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  });

  // Show the terminal
  terminal.show();
  
  // Optional: Display activation confirmation
  terminal.sendText("echo 'Zephyr environment activated'");
}
/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import { GlobalConfig } from "../types";
import { getPlatformConfig, SettingsManager } from "../config";

export async function openZephyrTerminalCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!config.isSetup) {
    vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
    return;
  }

  const pythonenv = path.join(SettingsManager.getToolsDirectory(), "env");
  const platformConfig = getPlatformConfig();
  const pathDivider = platformConfig.pathDivider;
  
  // Start with system environment (including system PATH)
  const terminalEnv: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      terminalEnv[key] = value;
    }
  }
  
  // Add all configured environment variables from settings
  const envVars = SettingsManager.getEnvironmentVariables();
  for (const [key, value] of Object.entries(envVars)) {
    if (value) {
      terminalEnv[key] = value;
    }
  }
  
  // Set VIRTUAL_ENV path
  terminalEnv["VIRTUAL_ENV"] = pythonenv;
  
  // Get all configured paths from settings
  const allPaths = SettingsManager.getAllPaths();
  
  // Build the complete PATH by prepending all tool paths
  let pathComponents: string[] = [];
  
  // Add Python environment paths first
  pathComponents.push(path.join(pythonenv, "Scripts"));
  pathComponents.push(path.join(pythonenv, "bin"));
  
  // Add all saved tool paths
  pathComponents = pathComponents.concat(allPaths);
  
  // Add the existing PATH from environment
  if (terminalEnv["PATH"]) {
    pathComponents.push(terminalEnv["PATH"]);
  }
  
  // Join all path components
  terminalEnv["PATH"] = pathComponents.filter(p => p).join(pathDivider);

  // Create terminal with the configured environment
  const terminal = vscode.window.createTerminal({
    name: "Zephyr Terminal",
    env: terminalEnv,
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  });

  // Show the terminal
  terminal.show();
  
  // Show success notification instead of echo
  vscode.window.showInformationMessage("Zephyr environment activated");
}
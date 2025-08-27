/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { SettingsManager } from "../config";
import { GlobalConfig } from "../types";

export async function populateDetectedPaths(config: GlobalConfig): Promise<void> {
  try {
    const toolsDir = SettingsManager.getToolsDirectory();
    
    // Detect and save Python executable if not set
    if (!SettingsManager.getPythonExecutable()) {
      const envBinPath = path.join(toolsDir, "env", process.platform === "win32" ? "Scripts" : "bin");
      const pythonPath = path.join(envBinPath, process.platform === "win32" ? "python.exe" : "python");
      if (await fs.pathExists(pythonPath)) {
        await SettingsManager.setPythonExecutable(pythonPath);
      }
    }
    
    // Detect and save West executable if not set
    if (!SettingsManager.getWestExecutable()) {
      const envBinPath = path.join(toolsDir, "env", process.platform === "win32" ? "Scripts" : "bin");
      const westPath = path.join(envBinPath, process.platform === "win32" ? "west.exe" : "west");
      if (await fs.pathExists(westPath)) {
        await SettingsManager.setWestExecutable(westPath);
      }
    }
    
    // Detect and save ZEPHYR_BASE if not set
    if (!SettingsManager.getZephyrBase()) {
      // Try to detect from workspace
      const detectedBase = await SettingsManager.detectZephyrBase();
      if (detectedBase) {
        await SettingsManager.setZephyrBase(detectedBase);
        await SettingsManager.setEnvironmentVariable("ZEPHYR_BASE", detectedBase);
      }
    }
    
    vscode.window.showInformationMessage("Path settings have been populated with detected values.");
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to populate paths: ${error}`);
  }
}

export async function resetPaths(): Promise<void> {
  const result = await vscode.window.showWarningMessage(
    "This will reset all custom path configurations to defaults. Continue?",
    { modal: true },
    "Reset",
    "Cancel"
  );
  
  if (result === "Reset") {
    try {
      // Clear all path settings
      await SettingsManager.setPythonExecutable("");
      await SettingsManager.setWestExecutable("");
      await SettingsManager.setZephyrBase("");
      await SettingsManager.setAllPaths([]);
      await SettingsManager.setToolsDirectory("");
      
      // Paths have been reset
      
      vscode.window.showInformationMessage("All path configurations have been reset to defaults.");
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reset paths: ${error}`);
    }
  }
}
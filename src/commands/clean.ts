/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { GlobalConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";

export async function cleanCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = ConfigValidator.validateSetupState(config);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  const project = await ProjectConfigManager.load(context);
  
  if (!project.target) {
    vscode.window.showErrorMessage('No project target set.');
    return;
  }

  try {
    // Clean build directory for the specific board
    const buildPath = project.board 
      ? path.join(project.target, 'build', project.board.split('/')[0])
      : path.join(project.target, 'build');
    
    await fs.remove(buildPath);
    vscode.window.showInformationMessage(`Cleaning ${project.target}`);
  } catch (error) {
    vscode.window.showErrorMessage('Failed to clean build directory.');
    console.error('Clean error:', error);
  }
}

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
import { DialogManager } from "../ui";

export async function cleanCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
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

export async function cleanIncompleteProjectCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  // Check if .west folder exists
  const westPath = path.join(workspaceRoot, '.west');
  const westExists = await fs.pathExists(westPath);
  
  if (!westExists) {
    vscode.window.showInformationMessage('No incomplete project found to clean.');
    return;
  }

  // Show confirmation dialog
  const folderName = path.basename(workspaceRoot);
  const choice = await vscode.window.showWarningMessage(
    `This will delete all files in "${folderName}". This action cannot be undone.`,
    { modal: true },
    "Delete All Files"
  );

  if (choice !== "Delete All Files") {
    return;
  }

  try {
    // Show progress
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Cleaning incomplete project",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Removing all files..." });
      
      // Get all items in the workspace root
      const items = await fs.readdir(workspaceRoot);
      
      // Remove each item
      for (const item of items) {
        const itemPath = path.join(workspaceRoot, item);
        await fs.remove(itemPath);
      }
      
      // Reset project configuration
      const project = await ProjectConfigManager.load(context);
      project.isInit = false;
      project.isInitializing = false;
      await ProjectConfigManager.save(context, project);
    });

    vscode.window.showInformationMessage('Incomplete project cleaned successfully. You can now start fresh.');
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to clean project: ${error}`);
    console.error('Clean incomplete project error:', error);
  }
}

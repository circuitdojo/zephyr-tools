/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig } from "../types";
import { ProjectConfigManager } from "../config";
import { BuildAssetsManager } from "../build/build-assets-manager";

export async function openBuildFolderCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);
  
  if (!project.target || !project.board) {
    vscode.window.showErrorMessage("No project or board selected. Configure your project first.");
    return;
  }

  await BuildAssetsManager.openBuildFolder(project);
}

export async function revealBuildAssetCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  filePath: string
): Promise<void> {
  if (!filePath) {
    vscode.window.showErrorMessage("No file path provided.");
    return;
  }

  await BuildAssetsManager.revealBuildAsset(filePath);
}

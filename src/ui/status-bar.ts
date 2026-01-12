/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";

export class StatusBarManager {
  private static boardStatusBarItem: vscode.StatusBarItem;
  private static projectStatusBarItem: vscode.StatusBarItem;
  private static extraConfFilesStatusBarItem: vscode.StatusBarItem;
  private static extraOverlayFilesStatusBarItem: vscode.StatusBarItem;

  static initializeStatusBarItems(context: vscode.ExtensionContext): void {
    // Create board status bar item with higher priority for more space
    this.boardStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    this.boardStatusBarItem.command = "zephyr-tools.change-board";
    this.boardStatusBarItem.text = "$(circuit-board) No Board";
    this.boardStatusBarItem.tooltip = "Click to change board";
    this.boardStatusBarItem.show();
    context.subscriptions.push(this.boardStatusBarItem);

    // Create extra conf files status bar item
    this.extraConfFilesStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 199);
    this.extraConfFilesStatusBarItem.command = "zephyr-tools.change-extra-conf-files";
    this.extraConfFilesStatusBarItem.text = "$(file) Default";
    this.extraConfFilesStatusBarItem.tooltip = "Click to change configuration files";
    this.extraConfFilesStatusBarItem.show();
    context.subscriptions.push(this.extraConfFilesStatusBarItem);

    // Create extra overlay files status bar item
    this.extraOverlayFilesStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 198);
    this.extraOverlayFilesStatusBarItem.command = "zephyr-tools.change-extra-overlay-files";
    this.extraOverlayFilesStatusBarItem.text = "$(file) Default";
    this.extraOverlayFilesStatusBarItem.tooltip = "Click to change overlay files";
    this.extraOverlayFilesStatusBarItem.show();
    context.subscriptions.push(this.extraOverlayFilesStatusBarItem);

    // Create project status bar item
    this.projectStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.projectStatusBarItem.command = "zephyr-tools.change-project";
    this.projectStatusBarItem.text = "$(folder) No Project";
    this.projectStatusBarItem.tooltip = "Click to change project";
    this.projectStatusBarItem.show();
    context.subscriptions.push(this.projectStatusBarItem);
  }

  static updateBoardStatusBar(board?: string): void {
    if (this.boardStatusBarItem) {
      const displayBoard = board ? this.truncateText(board, 40) : "No Board";
      this.boardStatusBarItem.text = `$(circuit-board) ${displayBoard}`;
      this.boardStatusBarItem.tooltip = board 
        ? `Board: ${board}\nClick to change board`
        : "Click to select a board";
    }
  }

  static updateProjectStatusBar(project?: string): void {
    if (this.projectStatusBarItem) {
      let displayProject = "No Project";

      if (project) {
        // Extract just the directory name from the full path for display
        displayProject = this.truncateText(path.basename(project), 25);
      }

      this.projectStatusBarItem.text = `$(folder) ${displayProject}`;
      this.projectStatusBarItem.tooltip = project
        ? `Project: ${project}\nClick to change project`
        : "Click to select a project";
    }
  }

  static updateExtraConfFilesStatusBar(extraConfFiles?: string[]): void {
    if (this.extraConfFilesStatusBarItem) {
      if (!extraConfFiles || extraConfFiles.length === 0) {
        this.extraConfFilesStatusBarItem.text = "$(file) Default";
        this.extraConfFilesStatusBarItem.tooltip = "Using default configuration (prj.conf)\nClick to add extra conf files";
      } else {
        const count = extraConfFiles.length;
        const fileNames = extraConfFiles.map(f => path.basename(f)).join(', ');
        this.extraConfFilesStatusBarItem.text = `$(file) ${count} conf${count > 1 ? 's' : ''}`;
        this.extraConfFilesStatusBarItem.tooltip = `Extra conf files:\n${fileNames}\nClick to change configuration files`;
      }
    }
  }

  static updateExtraOverlayFilesStatusBar(extraOverlayFiles?: string[]): void {
    if (this.extraOverlayFilesStatusBarItem) {
      if (!extraOverlayFiles || extraOverlayFiles.length === 0) {
        this.extraOverlayFilesStatusBarItem.text = "$(file) Default";
        this.extraOverlayFilesStatusBarItem.tooltip = "Using default overlay configuration\nClick to add extra overlay files";
      } else {
        const count = extraOverlayFiles.length;
        const fileNames = extraOverlayFiles.map(f => path.basename(f)).join(', ');
        this.extraOverlayFilesStatusBarItem.text = `$(file) ${count} overlay${count > 1 ? 's' : ''}`;
        this.extraOverlayFilesStatusBarItem.tooltip = `Extra overlay files:\n${fileNames}\nClick to change overlay files`;
      }
    }
  }

  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }

  static dispose(): void {
    if (this.boardStatusBarItem) {
      this.boardStatusBarItem.dispose();
    }
    if (this.extraConfFilesStatusBarItem) {
      this.extraConfFilesStatusBarItem.dispose();
    }
    if (this.extraOverlayFilesStatusBarItem) {
      this.extraOverlayFilesStatusBarItem.dispose();
    }
    if (this.projectStatusBarItem) {
      this.projectStatusBarItem.dispose();
    }
  }
}

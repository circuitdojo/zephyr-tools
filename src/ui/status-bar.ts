/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

export class StatusBarManager {
  private static boardStatusBarItem: vscode.StatusBarItem;
  private static projectStatusBarItem: vscode.StatusBarItem;

  static initializeStatusBarItems(context: vscode.ExtensionContext): void {
    // Create board status bar item with higher priority for more space
    this.boardStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    this.boardStatusBarItem.command = "zephyr-tools.change-board";
    this.boardStatusBarItem.text = "$(circuit-board) No Board";
    this.boardStatusBarItem.tooltip = "Click to change board";
    this.boardStatusBarItem.show();
    context.subscriptions.push(this.boardStatusBarItem);

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
        const path = require('path');
        displayProject = this.truncateText(path.basename(project), 25);
      }
      
      this.projectStatusBarItem.text = `$(folder) ${displayProject}`;
      this.projectStatusBarItem.tooltip = project
        ? `Project: ${project}\nClick to change project`
        : "Click to select a project";
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
    if (this.projectStatusBarItem) {
      this.projectStatusBarItem.dispose();
    }
  }
}

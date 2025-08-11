/**
 * @file quick-picks.ts
 * Provides an interface to handle quickpick dialogs.
 * 
 * @license Apache-2.0
 */

import * as vscode from 'vscode';

export class QuickPickManager {
  static async selectBoard(boards: string[]): Promise<string | undefined> {
    // Add custom board option at the beginning
    const CUSTOM_BOARD_OPTION = "$(edit) Enter custom board...";
    const boardOptions = [CUSTOM_BOARD_OPTION, ...boards];
    
    const selected = await vscode.window.showQuickPick(boardOptions, {
      placeHolder: "Select a board or enter custom",
      ignoreFocusOut: true,
    });
    
    if (selected === CUSTOM_BOARD_OPTION) {
      // Show input box for custom board
      return await vscode.window.showInputBox({
        prompt: "Enter custom board identifier (e.g., stm32h747i_disco/stm32h747xx/m4)",
        placeHolder: "board/variant/core",
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "Board identifier cannot be empty";
          }
          return null;
        }
      });
    }
    
    return selected;
  }

  static async selectProject(projects: string[]): Promise<string | undefined> {
    return await vscode.window.showQuickPick(projects, {
      placeHolder: "Select a project",
      ignoreFocusOut: true,
    });
  }

  static async selectToolchain(toolchains: string[]): Promise<string | undefined> {
    return await vscode.window.showQuickPick(toolchains, {
      placeHolder: "Select a toolchain",
      ignoreFocusOut: true,
    });
  }

  static async selectRunner(runners: string[]): Promise<string | undefined> {
    return await vscode.window.showQuickPick(runners, {
      placeHolder: "Select a runner",
      ignoreFocusOut: true,
    });
  }
}


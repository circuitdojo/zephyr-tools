/**
 * @file quick-picks.ts
 * Provides an interface to handle quickpick dialogs.
 * 
 * @license Apache-2.0
 */

import * as vscode from 'vscode';

export class QuickPickManager {
  static readonly BROWSE_PROJECT_OPTION = "$(folder-opened) Browse for project...";

  static async selectBoard(boards: string[], recentCount?: number): Promise<string | undefined> {
    // Add custom board option at the beginning
    const CUSTOM_BOARD_OPTION = "$(edit) Enter custom board...";
    const items: vscode.QuickPickItem[] = [{ label: CUSTOM_BOARD_OPTION }];

    if (recentCount && recentCount > 0) {
      // Add recent boards, then separator, then the rest
      for (let i = 0; i < recentCount && i < boards.length; i++) {
        items.push({ label: boards[i] });
      }
      if (recentCount < boards.length) {
        items.push({ label: "Other boards", kind: vscode.QuickPickItemKind.Separator });
        for (let i = recentCount; i < boards.length; i++) {
          items.push({ label: boards[i] });
        }
      }
    } else {
      for (const board of boards) {
        items.push({ label: board });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a board or enter custom",
      ignoreFocusOut: true,
    });
    
    if (!selected) {
      return undefined;
    }

    if (selected.label === CUSTOM_BOARD_OPTION) {
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

    return selected.label;
  }

  static async selectProject(projects: string[]): Promise<string | undefined> {
    const projectOptions = [this.BROWSE_PROJECT_OPTION, ...projects];
    return await vscode.window.showQuickPick(projectOptions, {
      placeHolder: "Select a project or browse for one",
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


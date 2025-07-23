/**
 * @file quick-picks.ts
 * Provides an interface to handle quickpick dialogs.
 * 
 * @license Apache-2.0
 */

import * as vscode from 'vscode';

export class QuickPickManager {
  static async selectBoard(boards: string[]): Promise<string | undefined> {
    return await vscode.window.showQuickPick(boards, {
      placeHolder: "Select a board",
      ignoreFocusOut: true,
    });
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


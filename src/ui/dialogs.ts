/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

export class DialogManager {
  static async getRepositoryUrl(): Promise<string | undefined> {
    const inputOptions: vscode.InputBoxOptions = {
      prompt: "Enter git repository URL.",
      placeHolder: "<Enter your git repository address here>",
      ignoreFocusOut: true,
      validateInput: text => {
        return text !== undefined && text !== "" ? null : "Enter a valid git repository address.";
      },
    };

    return await vscode.window.showInputBox(inputOptions);
  }

  static async getBranchName(): Promise<string | undefined> {
    const branchInputOptions: vscode.InputBoxOptions = {
      prompt: "Enter branch name.",
      placeHolder: "Press enter for default",
      ignoreFocusOut: true,
    };

    return await vscode.window.showInputBox(branchInputOptions);
  }

  static async getDestinationFolder(): Promise<vscode.Uri | undefined> {
    const dialogOptions: vscode.OpenDialogOptions = {
      canSelectFiles: false,
      canSelectFolders: true,
      title: "Select destination folder."
    };

    const result = await vscode.window.showOpenDialog(dialogOptions);
    return result?.[0];
  }

  /**
   * Gets destination folder, prompting user if not provided
   * This replicates the behavior of the old helper.get_dest function
   */
  static async getDestination(dest?: vscode.Uri): Promise<vscode.Uri | null> {
    // If destination is provided, use it
    if (dest) {
      return dest;
    }

    // If not provided, prompt user to select folder
    const dialogOptions: vscode.OpenDialogOptions = {
      canSelectFiles: false,
      canSelectFolders: true,
      title: "Select destination folder."
    };

    const result = await vscode.window.showOpenDialog(dialogOptions);
    if (!result) {
      vscode.window.showErrorMessage('Provide a target folder.');
      return null;
    }

    return result[0];
  }

  static async getRunnerArguments(): Promise<string | undefined> {
    return await vscode.window.showInputBox({
      placeHolder: "Enter runner args..",
      ignoreFocusOut: true,
    });
  }

  static async selectSysBuildOption(): Promise<boolean | undefined> {
    const result = await vscode.window.showQuickPick(["Yes", "No"], {
      placeHolder: "Enable sysbuild?",
      ignoreFocusOut: true,
    });

    if (result === "Yes") return true;
    if (result === "No") return false;
    return undefined;
  }

  static async selectSerialPort(ports: string[]): Promise<string | undefined> {
    return await vscode.window.showQuickPick(ports, {
      title: "Pick your serial port.",
      placeHolder: ports[0],
      ignoreFocusOut: true,
    });
  }

  static async selectBaudRate(baudList: string[], defaultBaud?: string): Promise<string | undefined> {
    const result = await vscode.window.showQuickPick(baudList, {
      title: "Pick your baud rate.",
      placeHolder: defaultBaud || baudList[0],
      ignoreFocusOut: true,
    });

    return result || defaultBaud;
  }
}

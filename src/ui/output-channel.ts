/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

export class OutputChannelManager {
  private static output: vscode.OutputChannel;
  private static readonly CHANNEL_NAME = "Zephyr Tools";

  static getChannel(): vscode.OutputChannel {
    if (!this.output) {
      this.output = vscode.window.createOutputChannel(this.CHANNEL_NAME);
    }
    return this.output;
  }

  static appendLine(message: string): void {
    this.getChannel().appendLine(message);
  }

  static append(message: string): void {
    this.getChannel().append(message);
  }

  static show(): void {
    this.getChannel().show();
  }

  static clear(): void {
    this.getChannel().clear();
  }

  static dispose(): void {
    if (this.output) {
      this.output.dispose();
    }
  }
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig } from "../types";

export class GlobalConfigManager {
  private static readonly CONFIG_KEY = "zephyr.env";

  static async load(context: vscode.ExtensionContext): Promise<GlobalConfig> {
    return context.globalState.get(this.CONFIG_KEY) ?? {
      env: process.env,
      manifestVersion: 0,
      isSetup: false,
    };
  }

  static async save(context: vscode.ExtensionContext, config: GlobalConfig): Promise<void> {
    await context.globalState.update(this.CONFIG_KEY, config);
  }

  static async reset(context: vscode.ExtensionContext): Promise<void> {
    await context.globalState.update(this.CONFIG_KEY, undefined);
  }
}

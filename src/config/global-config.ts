/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig } from "../types";

export class GlobalConfigManager {
  private static readonly CONFIG_KEY = "zephyr.env";
  private static _onDidChangeConfig = new vscode.EventEmitter<GlobalConfig>();
  public static readonly onDidChangeConfig = GlobalConfigManager._onDidChangeConfig.event;

  static async load(context: vscode.ExtensionContext): Promise<GlobalConfig> {
    return context.globalState.get(this.CONFIG_KEY) ?? {
      env: process.env,
      manifestVersion: 0,
      isSetup: false,
    };
  }

  static async save(context: vscode.ExtensionContext, config: GlobalConfig): Promise<void> {
    await context.globalState.update(this.CONFIG_KEY, config);
    // Fire event to notify listeners of config changes
    this._onDidChangeConfig.fire(config);
  }

  static async reset(context: vscode.ExtensionContext): Promise<void> {
    await context.globalState.update(this.CONFIG_KEY, undefined);
    // Load default config and fire event
    const defaultConfig: GlobalConfig = {
      env: process.env,
      manifestVersion: 0,
      isSetup: false,
    };
    this._onDidChangeConfig.fire(defaultConfig);
  }
}

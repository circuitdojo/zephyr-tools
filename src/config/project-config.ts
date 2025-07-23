/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { ProjectConfig, ZephyrTask } from "../types";

// Default project configuration
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  isInit: false,
  sysbuild: true,
};

export class ProjectConfigManager {
  // Event emitter for configuration change
  private static _onDidChangeConfig: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  static readonly onDidChangeConfig: vscode.Event<void> = ProjectConfigManager._onDidChangeConfig.event;
  private static readonly PROJECT_CONFIG_KEY = "zephyr.project";
  private static readonly TASK_CONFIG_KEY = "zephyr.task";

  static async load(context: vscode.ExtensionContext): Promise<ProjectConfig> {
    return context.workspaceState.get(this.PROJECT_CONFIG_KEY) ?? DEFAULT_PROJECT_CONFIG;
  }

  static async save(context: vscode.ExtensionContext, config: ProjectConfig): Promise<void> {
    await context.workspaceState.update(this.PROJECT_CONFIG_KEY, config);
    ProjectConfigManager._onDidChangeConfig.fire(); // Notify listeners of changes
  }

  static async loadPendingTask(context: vscode.ExtensionContext): Promise<ZephyrTask | undefined> {
    return context.globalState.get(this.TASK_CONFIG_KEY);
  }

  static async savePendingTask(context: vscode.ExtensionContext, task: ZephyrTask | undefined): Promise<void> {
    await context.globalState.update(this.TASK_CONFIG_KEY, task);
  }

  static async clearPendingTask(context: vscode.ExtensionContext): Promise<void> {
    await context.globalState.update(this.TASK_CONFIG_KEY, undefined);
  }
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { BuildConfigSnapshot, ProjectConfig, ZephyrTask } from "../types";

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

  /**
   * Self-heal the project init flag from on-disk state. A `.west` folder plus a
   * fetched Zephyr tree (`zephyr/VERSION`) means the project is already initialized
   * — e.g. it was cloned, or the extension's workspace state was reset. Restore the
   * flag so commands don't wrongly demand "Init Repo".
   *
   * This must live outside the sidebar webview: a cold start that never opens the
   * sidebar would otherwise leave `isInit` false and make build/flash/update report
   * "Run `Zephyr Tools: Init Repo` command first" for an already-initialized project.
   *
   * Returns the (possibly updated) project config.
   */
  static async healInitStateFromDisk(context: vscode.ExtensionContext): Promise<ProjectConfig> {
    const project = await this.load(context);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || project.isInit) {
      return project;
    }

    const fs = await import("fs-extra");
    const path = await import("path");

    const westFolderExists = await fs.pathExists(path.join(workspaceRoot, ".west"));
    if (!westFolderExists) {
      return project;
    }

    const zephyrReady = await fs.pathExists(path.join(workspaceRoot, "zephyr", "VERSION"));
    if (zephyrReady) {
      console.log("Detected an initialized project on disk, restoring isInit flag");
      project.isInit = true;
      await this.save(context, project);
    }

    return project;
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

  static async loadBuildSnapshot(context: vscode.ExtensionContext, buildPath: string): Promise<BuildConfigSnapshot | undefined> {
    return context.workspaceState.get(`zephyr.buildSnapshot.${buildPath}`);
  }

  static async saveBuildSnapshot(context: vscode.ExtensionContext, buildPath: string, snapshot: BuildConfigSnapshot): Promise<void> {
    await context.workspaceState.update(`zephyr.buildSnapshot.${buildPath}`, snapshot);
  }
}

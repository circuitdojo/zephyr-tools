/**
 * @fileoverview Manages the Zephyr Tools sidebar
 * This is responsible for creating and updating the TreeView
 */

import * as vscode from "vscode";
import { GlobalConfigManager, ProjectConfigManager } from "../config";
import { ZephyrTreeItem, ZephyrTreeItemType, SectionTreeItem, ConfigItemTreeItem, ActionButtonTreeItem } from "./sidebar-tree-items";

export class SidebarManager implements vscode.TreeDataProvider<ZephyrTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ZephyrTreeItem | undefined | void> = new vscode.EventEmitter<ZephyrTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ZephyrTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {
    // Subscribe to configuration changes to refresh the tree
    ProjectConfigManager.onDidChangeConfig(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ZephyrTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ZephyrTreeItem): Promise<ZephyrTreeItem[]> {
    if (!element) {
      return await this.getRootItems();
    }

    // Handle children for sections
    if (element.type === ZephyrTreeItemType.Section) {
      return await this.getSectionChildren(element.label);
    }

    return [];
  }

  private async getRootItems(): Promise<ZephyrTreeItem[]> {
    return [
      new SectionTreeItem("Project Overview"),
      new SectionTreeItem("Configuration Controls"),
      new SectionTreeItem("Task Management")
    ];
  }

  private async getSectionChildren(sectionLabel: string): Promise<ZephyrTreeItem[]> {
    const config = await GlobalConfigManager.load(this.context);
    const project = await ProjectConfigManager.load(this.context);

    if (!config || !project) {
      return [];
    }

    switch (sectionLabel) {
      case "Project Overview":
        return [
          new ConfigItemTreeItem("Board", project.board || "No Board Selected", "zephyr-tools.change-board"),
          new ConfigItemTreeItem("Target", this.getTargetDisplayName(project.target), "zephyr-tools.change-project"),
          new ConfigItemTreeItem("Runner", project.runner || "default", "zephyr-tools.change-runner"),
          new ConfigItemTreeItem("Sysbuild", project.sysbuild ? "Enabled" : "Disabled", "zephyr-tools.change-sysbuild")
        ];

      case "Configuration Controls":
        return [
          new ActionButtonTreeItem("Probe-rs Settings", "zephyr-tools.change-probe-rs-settings", [], "settings-gear")
        ];

      case "Task Management":
        return [
          new ActionButtonTreeItem("Build", "zephyr-tools.build", [], "play"),
          new ActionButtonTreeItem("Build Pristine", "zephyr-tools.build-pristine", [], "refresh"),
          new ActionButtonTreeItem("Flash", "zephyr-tools.flash", [], "zap"),
          new ActionButtonTreeItem("Flash & Monitor", "zephyr-tools.flash-and-monitor", [], "debug-alt"),
          new ActionButtonTreeItem("Monitor", "zephyr-tools.monitor", [], "device-desktop")
        ];

      default:
        return [];
    }
  }

  private getTargetDisplayName(target?: string): string {
    if (!target) {
      return "No Target Selected";
    }
    
    // Extract just the directory name from the full path for display
    const path = require('path');
    return path.basename(target);
  }
}

export function activateSidebar(context: vscode.ExtensionContext) {
  const sidebarManager = new SidebarManager(context);
  vscode.window.registerTreeDataProvider("zephyrToolsSidebar", sidebarManager);
}

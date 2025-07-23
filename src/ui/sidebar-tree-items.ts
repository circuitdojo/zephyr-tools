/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

export enum ZephyrTreeItemType {
  Section = "section",
  ConfigItem = "configItem",
  ActionButton = "actionButton"
}

export class ZephyrTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: ZephyrTreeItemType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly command?: vscode.Command,
    public readonly description?: string,
    public readonly tooltip?: string,
    public readonly iconPath?: string | vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri }
  ) {
    super(label, collapsibleState);
    
    this.description = description;
    this.tooltip = tooltip;
    this.command = command;
    this.iconPath = iconPath;
    
    // Set context value for conditional visibility/behavior
    this.contextValue = type;
  }
}

export class SectionTreeItem extends ZephyrTreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
  ) {
    super(
      label,
      ZephyrTreeItemType.Section,
      collapsibleState,
      undefined,
      undefined,
      undefined,
      new vscode.ThemeIcon("folder")
    );
  }
}

export class ConfigItemTreeItem extends ZephyrTreeItem {
  constructor(
    label: string,
    value: string,
    changeCommand: string,
    tooltip?: string
  ) {
    super(
      label,
      ZephyrTreeItemType.ConfigItem,
      vscode.TreeItemCollapsibleState.None,
      {
        command: changeCommand,
        title: `Change ${label}`,
        arguments: []
      },
      value,
      tooltip || `Click to change ${label.toLowerCase()}`,
      new vscode.ThemeIcon("settings-gear")
    );
  }
}

export class ActionButtonTreeItem extends ZephyrTreeItem {
  constructor(
    label: string,
    command: string,
    args: any[] = [],
    icon: string = "play",
    tooltip?: string
  ) {
    super(
      label,
      ZephyrTreeItemType.ActionButton,
      vscode.TreeItemCollapsibleState.None,
      {
        command: command,
        title: label,
        arguments: args
      },
      undefined,
      tooltip,
      new vscode.ThemeIcon(icon)
    );
  }
}

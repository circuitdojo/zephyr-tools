/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from 'vscode';
import { GlobalConfig } from '../types';
import { ProjectConfigManager } from '../config/project-config';
import { StatusBarManager } from '../ui/status-bar';

/**
 * Prompt user to enter a CMake define
 */
async function promptForDefine(): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter a CMake define (KEY=VALUE or -DKEY=VALUE)',
    placeHolder: 'e.g., CONFIG_MY_OPTION="value" or -DCONFIG_MY_OPTION="value"',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Define cannot be empty';
      }
      // Strip -D prefix for validation
      const stripped = value.trim().replace(/^-D/, '');
      if (!stripped.includes('=')) {
        return 'Define must be in KEY=VALUE format';
      }
      const key = stripped.split('=')[0];
      if (!key || key.trim().length === 0) {
        return 'Key cannot be empty';
      }
      return null;
    },
  });

  if (!input) {
    return undefined;
  }

  // Normalize: strip -D prefix if provided, store as KEY=VALUE
  return input.trim().replace(/^-D/, '');
}

/**
 * Command to change extra CMake defines
 */
export async function changeCMakeDefinesCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!project.target) {
    vscode.window.showErrorMessage('No project target set. Please set a target first.');
    return;
  }

  if (!project.extraCMakeDefines) {
    project.extraCMakeDefines = [];
  }
  const currentDefines = project.extraCMakeDefines;

  // Build action menu based on current state
  const actionMenuItems = [];

  if (currentDefines.length > 0) {
    actionMenuItems.push({
      label: '$(edit) Manage defines',
      description: `Edit current defines (${currentDefines.length} define${currentDefines.length > 1 ? 's' : ''})`,
      action: 'manage' as const,
    });
  }

  actionMenuItems.push({
    label: '$(add) Add define...',
    description: 'Enter a new CMake define (KEY=VALUE)',
    action: 'add' as const,
  });

  if (currentDefines.length > 0) {
    actionMenuItems.push({
      label: '$(trash) Clear all defines',
      description: 'Remove all extra CMake defines',
      action: 'clear' as const,
    });
  }

  const action = await vscode.window.showQuickPick(actionMenuItems, {
    placeHolder: currentDefines.length > 0
      ? 'Manage extra CMake defines'
      : 'What would you like to do?',
    ignoreFocusOut: true,
  });

  if (!action) {
    return;
  }

  if (action.action === 'clear') {
    project.extraCMakeDefines = [];
    await ProjectConfigManager.save(context, project);
    StatusBarManager.updateCMakeDefinesStatusBar(project.extraCMakeDefines);
    vscode.window.showInformationMessage('Cleared all extra CMake defines.');
    return;
  }

  if (action.action === 'add') {
    let addMore = true;
    while (addMore) {
      const define = await promptForDefine();

      if (!define) {
        break;
      }

      // Check for duplicate key (update value if key exists)
      const newKey = define.split('=')[0];
      const existingIndex = project.extraCMakeDefines!.findIndex(d => d.split('=')[0] === newKey);
      if (existingIndex >= 0) {
        project.extraCMakeDefines![existingIndex] = define;
        vscode.window.showInformationMessage(`Updated define: ${newKey}`);
      } else {
        project.extraCMakeDefines!.push(define);
        vscode.window.showInformationMessage(`Added define: ${newKey}`);
      }

      await ProjectConfigManager.save(context, project);
      StatusBarManager.updateCMakeDefinesStatusBar(project.extraCMakeDefines);

      // Ask if they want to continue adding
      const continueAction = await vscode.window.showQuickPick(
        ['Add another define', 'Done'],
        {
          placeHolder: 'Would you like to add more defines?',
          ignoreFocusOut: true,
        }
      );

      addMore = continueAction === 'Add another define';
    }
    return;
  }

  // action.action === 'manage' - Show multi-select to toggle defines
  interface DefineQuickPickItem extends vscode.QuickPickItem {
    defineValue: string;
  }

  const items: DefineQuickPickItem[] = currentDefines.map(define => {
    const [key, ...rest] = define.split('=');
    const value = rest.join('=');
    return {
      label: key,
      description: value,
      defineValue: define,
      picked: true,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Uncheck defines to remove them (Space to toggle, Enter to confirm)',
    ignoreFocusOut: true,
    title: `Editing CMake Defines (${currentDefines.length} currently set)`,
  });

  if (selected === undefined) {
    return;
  }

  project.extraCMakeDefines = selected.map(item => item.defineValue);
  await ProjectConfigManager.save(context, project);
  StatusBarManager.updateCMakeDefinesStatusBar(project.extraCMakeDefines);

  const count = project.extraCMakeDefines.length;
  if (count === 0) {
    vscode.window.showInformationMessage('Cleared all CMake defines.');
  } else {
    vscode.window.showInformationMessage(
      `${count} CMake define${count > 1 ? 's' : ''} set.`
    );
  }
}

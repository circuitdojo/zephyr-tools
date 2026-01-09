/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalConfig } from '../types';
import { ProjectConfigManager } from '../config/project-config';
import { StatusBarManager } from '../ui/status-bar';

/**
 * Recursively scan directory for .conf files
 */
async function findConfFiles(baseDir: string): Promise<string[]> {
  const confFiles: string[] = [];

  async function scan(dir: string) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        // Skip common non-project directories
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'target', 'build', '.venv', '.zephyr-tools'].includes(entry.name)) {
            await scan(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.conf')) {
          confFiles.push(relativePath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
      return;
    }
  }

  await scan(baseDir);
  return confFiles.sort(); // Alphabetical order
}

/**
 * Prompt user to manually add a conf file
 */
async function promptForManualConfFile(projectDir: string): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: '$(file) Browse for file...',
        description: 'Use file picker to select a .conf file',
        action: 'browse' as const,
      },
      {
        label: '$(edit) Enter path manually...',
        description: 'Type a relative or absolute path',
        action: 'manual' as const,
      },
    ],
    {
      placeHolder: 'How would you like to add the conf file?',
      ignoreFocusOut: true,
    }
  );

  if (!choice) {
    return undefined;
  }

  if (choice.action === 'browse') {
    // Use file picker
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Configuration Files': ['conf'],
        'All Files': ['*'],
      },
      defaultUri: vscode.Uri.file(projectDir),
      openLabel: 'Select Conf File',
    });

    if (fileUri && fileUri[0]) {
      // Convert to relative path if possible
      const absolutePath = fileUri[0].fsPath;

      // Check if file is within project directory
      if (absolutePath.startsWith(projectDir)) {
        return path.relative(projectDir, absolutePath);
      } else {
        // File is outside project - ask user if they want absolute or relative path
        const useAbsolute = await vscode.window.showQuickPick(
          ['Use absolute path', 'Use relative path'],
          {
            placeHolder: 'File is outside project directory. How should it be referenced?',
            ignoreFocusOut: true,
          }
        );

        if (useAbsolute === 'Use absolute path') {
          return absolutePath;
        } else if (useAbsolute === 'Use relative path') {
          return path.relative(projectDir, absolutePath);
        }
      }
    }
  } else if (choice.action === 'manual') {
    // Manual text entry
    const manualPath = await vscode.window.showInputBox({
      prompt: 'Enter path to .conf file (relative to project root, or absolute)',
      placeHolder: 'e.g., overlay-custom.conf or ../shared/common.conf',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Path cannot be empty';
        }
        if (!value.endsWith('.conf')) {
          return 'File must have .conf extension';
        }
        return null;
      },
    });

    if (manualPath) {
      return manualPath.trim();
    }
  }

  return undefined;
}

/**
 * Command to change extra conf files
 */
export async function changeExtraConfFilesCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const project = await ProjectConfigManager.load(context);

  if (!project.target) {
    vscode.window.showErrorMessage('No project target set. Please set a target first.');
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const projectDir = project.target;
  const currentSelection = project.extraConfFiles || [];

  // Build action menu based on current selection state
  const actionMenuItems = [];

  if (currentSelection.length > 0) {
    // If files are already selected, prioritize "Manage selection"
    actionMenuItems.push({
      label: '$(edit) Manage selection',
      description: `Edit current selection (${currentSelection.length} file${currentSelection.length > 1 ? 's' : ''} selected)`,
      action: 'select' as const,
    });
  } else {
    // If nothing selected, show "Select from detected"
    actionMenuItems.push({
      label: '$(list-selection) Select from detected .conf files',
      description: 'Choose from .conf files found in project',
      action: 'select' as const,
    });
  }

  actionMenuItems.push({
    label: '$(add) Add file manually...',
    description: 'Browse or enter path to a .conf file',
    action: 'add-manual' as const,
  });

  // Only show clear option if there are files to clear
  if (currentSelection.length > 0) {
    actionMenuItems.push({
      label: '$(trash) Clear all selections',
      description: 'Remove all extra conf files and use default only',
      action: 'clear' as const,
    });
  }

  // Show action menu
  const action = await vscode.window.showQuickPick(actionMenuItems, {
    placeHolder: currentSelection.length > 0
      ? 'Manage extra conf files'
      : 'What would you like to do?',
    ignoreFocusOut: true,
  });

  if (!action) {
    // User cancelled
    return;
  }

  if (action.action === 'clear') {
    // Immediately clear selections
    project.extraConfFiles = [];
    await ProjectConfigManager.save(context, project);
    StatusBarManager.updateExtraConfFilesStatusBar(project.extraConfFiles);
    vscode.window.showInformationMessage('Cleared all extra conf files. Using default configuration.');
    return;
  }

  if (action.action === 'add-manual') {
    // Show manual file addition flow
    const manualFile = await promptForManualConfFile(projectDir);

    if (manualFile) {
      // Add to current selection
      const newSelection = [...currentSelection];
      if (!newSelection.includes(manualFile)) {
        newSelection.push(manualFile);
      }

      project.extraConfFiles = newSelection;
      await ProjectConfigManager.save(context, project);
      StatusBarManager.updateExtraConfFilesStatusBar(project.extraConfFiles);

      vscode.window.showInformationMessage(
        `Added ${path.basename(manualFile)}. You can add more or select from detected files.`
      );

      // Ask if they want to continue
      const continueAction = await vscode.window.showQuickPick(
        ['Continue adding files', 'Done'],
        {
          placeHolder: 'Would you like to add more files?',
          ignoreFocusOut: true,
        }
      );

      if (continueAction === 'Continue adding files') {
        return changeExtraConfFilesCommand(config, context);
      }
    }
    return;
  }

  // action.action === 'select' - Show file selection
  let confFiles: string[];

  try {
    confFiles = await findConfFiles(projectDir);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to scan for .conf files: ${error}`);
    return;
  }

  if (confFiles.length === 0) {
    vscode.window.showInformationMessage(
      'No .conf files found in the project directory. Use "Add file manually" to specify a file.'
    );
    return;
  }

  // Interface for QuickPick items
  interface ConfFileQuickPickItem extends vscode.QuickPickItem {
    filePath: string;
    isManual?: boolean;
  }

  // Separate auto-detected files from manually added ones
  const detectedFiles = new Set(confFiles);
  const manuallyAddedFiles = currentSelection.filter(file => !detectedFiles.has(file));

  // Build QuickPick items
  const items: ConfFileQuickPickItem[] = [];

  // Add manually added files first (with special indicator)
  manuallyAddedFiles.forEach(file => {
    const dirname = path.dirname(file);
    items.push({
      label: dirname && dirname !== '.' ? file : path.basename(file),
      description: 'manually added',
      filePath: file,
      isManual: true,
      picked: currentSelection.includes(file),
    });
  });

  // Add detected files
  confFiles.forEach(file => {
    const dirname = path.dirname(file);
    items.push({
      label: dirname && dirname !== '.' ? file : path.basename(file),
      description: undefined, // No description for auto-detected files
      filePath: file,
      picked: currentSelection.includes(file),
    });
  });

  // Show multi-select QuickPick
  const isEditing = currentSelection.length > 0;
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: isEditing
      ? 'Toggle files to add/remove (Space to toggle, Enter to confirm)'
      : 'Select configuration files (Space to toggle, Enter to confirm)',
    ignoreFocusOut: true,
    title: isEditing
      ? `Editing Extra Conf Files (${currentSelection.length} currently selected)`
      : 'Select Extra Conf Files',
  });

  if (selected === undefined) {
    // User cancelled
    return;
  }

  // Update selection
  project.extraConfFiles = selected.map(item => item.filePath);

  await ProjectConfigManager.save(context, project);
  StatusBarManager.updateExtraConfFilesStatusBar(project.extraConfFiles);

  // Show confirmation
  const count = project.extraConfFiles.length;
  if (count === 0) {
    vscode.window.showInformationMessage('Using default configuration only');
  } else {
    const fileNames = project.extraConfFiles.map(f => path.basename(f)).join(', ');
    const action = isEditing ? 'Updated' : 'Selected';
    vscode.window.showInformationMessage(
      `${action} ${count} conf file${count > 1 ? 's' : ''}: ${fileNames}`
    );
  }
}

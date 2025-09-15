/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfigManager, ProjectConfigManager } from "../config";
import { GlobalConfig, ProjectConfig } from "../types";
import { BuildAssetsManager, BuildAssetsState } from "../build/build-assets-manager";

interface SidebarState {
  type: 'loading' | 'setup-required' | 'project-required' | 'project-incomplete' | 'initializing' | 'setup-in-progress' | 'ready';
  config: GlobalConfig;
  project: ProjectConfig;
  hasWorkspace: boolean;
  buildAssets?: BuildAssetsState;
}

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'zephyrToolsSidebar';

  private _view?: vscode.WebviewView;
  private _buildAssetsWatcher?: vscode.FileSystemWatcher | null;
  private _currentProjectKey?: string;

  constructor(private readonly _extensionUri: vscode.Uri, private context: vscode.ExtensionContext) {
    // Subscribe to configuration changes to refresh the webview
    ProjectConfigManager.onDidChangeConfig(() => this.refresh());
    GlobalConfigManager.onDidChangeConfig(() => this.refresh());
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log('Webview message received:', data);
      try {
        switch (data.type) {
          case 'command':
            console.log('Executing command:', data.command);
            // Special handling for init-repo with workspace flag
            if (data.command === 'zephyr-tools.init-repo' && data.useWorkspace) {
              const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
              if (workspaceFolder) {
                await vscode.commands.executeCommand(data.command, workspaceFolder.uri);
              } else {
                vscode.window.showErrorMessage('No workspace folder found');
              }
            } else {
              await vscode.commands.executeCommand(data.command, ...(data.args || []));
            }
            break;
          case 'refresh':
            await this.refresh();
            break;
        }
      } catch (error) {
        console.error('Error handling webview message:', error);
        vscode.window.showErrorMessage(`Failed to execute command: ${error}`);
      }
    });

    // Initialize with current data
    this.refresh();
  }

  public async refresh() {
    if (this._view) {
      // Show loading state initially
      this._view.webview.postMessage({
        type: 'update',
        data: {
          state: {
            type: 'loading',
            config: {} as GlobalConfig,
            project: {} as ProjectConfig,
            hasWorkspace: false
          },
          config: {} as GlobalConfig,
          project: {} as ProjectConfig
        }
      });

      const config = await GlobalConfigManager.load(this.context);
      const project = await ProjectConfigManager.load(this.context);
      const state = await this.determineState(config, project);
      
      // Set up file watching for build assets if we're in ready state
      this.setupBuildAssetsWatcher(project);
      
      // Always refresh build assets if we're in ready state and have project configuration
      let buildAssets: BuildAssetsState | undefined = state.buildAssets;
      if (state.type === 'ready' && project.target && project.board) {
        try {
          buildAssets = await BuildAssetsManager.getBuildAssetsState(project);
        } catch (error) {
          console.error('Failed to refresh build assets:', error);
        }
      }
      
      // Auto-reveal the sidebar when in progress states
      if (state.type === 'initializing' || state.type === 'setup-in-progress') {
        await this.revealSidebar();
      }
      
      this._view.webview.postMessage({
        type: 'update',
        data: {
          state: {
            ...state,
            buildAssets
          },
          config,
          project,
          buildAssets
        }
      });
    }
  }

  private async determineState(config: GlobalConfig, project: ProjectConfig): Promise<SidebarState> {
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    
    // Check if setup is in progress
    if (config.isSetupInProgress) {
      return {
        type: 'setup-in-progress',
        config,
        project,
        hasWorkspace
      };
    }
    
    // Import validation here to avoid circular dependencies
    const { ConfigValidator } = await import('../config/validation');
    
    // Check setup state with manifest validation
    const setupValidation = await ConfigValidator.validateSetupState(config, this.context, true);
    if (!setupValidation.isValid) {
      return {
        type: 'setup-required',
        config,
        project,
        hasWorkspace
      };
    }
    
    // Check if initialization is in progress
    if (project.isInitializing) {
      return {
        type: 'initializing',
        config,
        project,
        hasWorkspace
      };
    }
    
    // Check if project initialization is required
    // First check if .west folder actually exists in current workspace
    const fs = await import('fs-extra');
    const path = await import('path');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const westFolderExists = workspaceRoot ? await fs.pathExists(path.join(workspaceRoot, '.west')) : false;
    
    // Check for incomplete project (west folder exists but not marked as initialized)
    if (westFolderExists && !project.isInit) {
      return {
        type: 'project-incomplete',
        config,
        project,
        hasWorkspace
      };
    }
    
    // No west folder at all
    if (!project.isInit || !westFolderExists) {
      return {
        type: 'project-required',
        config,
        project,
        hasWorkspace
      };
    }
    
    // All good - ready state
    // Load build assets for ready state
    let buildAssets: BuildAssetsState | undefined;
    try {
      buildAssets = await BuildAssetsManager.getBuildAssetsState(project);
    } catch (error) {
      console.error('Failed to load build assets:', error);
    }
    
    return {
      type: 'ready',
      config,
      project,
      hasWorkspace,
      buildAssets
    };
  }

  private setupBuildAssetsWatcher(project: ProjectConfig): void {
    // Only set up watcher if we don't have one or project config changed
    const projectKey = `${project.target}:${project.board}`;
    if (this._buildAssetsWatcher && this._currentProjectKey === projectKey) {
      return; // Watcher already exists for this project
    }
    
    // Dispose existing watcher if any
    if (this._buildAssetsWatcher) {
      console.log('Disposing existing build assets watcher');
      this._buildAssetsWatcher.dispose();
      this._buildAssetsWatcher = null;
    }

    // Create new watcher if project is configured
    if (project.target && project.board) {
      console.log('Setting up build assets watcher for project:', {
        target: project.target,
        board: project.board
      });
      try {
        this._buildAssetsWatcher = BuildAssetsManager.createFileWatcher(
          project,
          () => {
            console.log('Build assets watcher triggered, refreshing sidebar');
            this.refresh();
          }
        );
        this._currentProjectKey = projectKey;
        console.log('Build assets watcher setup result:', this._buildAssetsWatcher ? 'success' : 'failed');
      } catch (error) {
        console.error('Failed to set up build assets watcher:', error);
      }
    } else {
      console.log('Cannot set up build assets watcher - missing project configuration:', {
        target: project.target,
        board: project.board
      });
      this._currentProjectKey = undefined;
    }
  }

  public async revealSidebar() {
    try {
      // First reveal the Zephyr Tools view container in the activity bar
      await vscode.commands.executeCommand('workbench.view.extension.zephyr-tools');
      
      // Wait a bit for the view container to initialize if needed
      if (!this._view) {
        // Try to force view initialization by focusing on the specific view
        try {
          await vscode.commands.executeCommand('zephyrToolsSidebar.focus');
        } catch {
          // If that doesn't work, continue silently
        }
        
        // Wait a bit more for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Focus on the specific sidebar view
      if (this._view) {
        this._view.show?.(true); // true = focus the view
      }
    } catch (error) {
      // Silently fail if commands are not available
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.js'));
    const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
    const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.css'));

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-inline';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${styleMainUri}" rel="stylesheet">
        <title>Zephyr Tools</title>
      </head>
      <body>
        <div class="container">
          <!-- Project Status Card -->
          <div class="card project-status">
            <h3 class="card-title">Project Settings</h3>
            <div class="status-grid">
              <div class="status-item" data-command="zephyr-tools.change-board">
                <span class="status-label">Board:</span>
                <span class="status-value" id="board-value">Loading...</span>
                <span class="status-edit">✏️</span>
              </div>
              <div class="status-item" data-command="zephyr-tools.change-project">
                <span class="status-label">Target:</span>
                <span class="status-value" id="target-value">Loading...</span>
                <span class="status-edit">✏️</span>
              </div>
              <div class="status-item" data-command="zephyr-tools.change-runner">
                <span class="status-label">Runner:</span>
                <span class="status-value" id="runner-value">Loading...</span>
                <span class="status-edit">✏️</span>
              </div>
              <div class="status-item" data-command="zephyr-tools.change-sysbuild">
                <span class="status-label">Sysbuild:</span>
                <span class="status-value" id="sysbuild-value">Loading...</span>
                <span class="status-edit">✏️</span>
              </div>
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="card quick-actions">
            <h3 class="card-title">Quick Actions</h3>
            <div class="action-grid">
              <button class="action-btn tertiary" data-command="zephyr-tools.build">
                <span class="action-icon">🔨</span>
                <span class="action-text">Build</span>
              </button>
              <button class="action-btn secondary" data-command="zephyr-tools.build-pristine">
                <span class="action-icon">🔄</span>
                <span class="action-text">Build Pristine</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.flash">
                <span class="action-icon">⚡</span>
                <span class="action-text">Flash</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.flash-and-monitor">
                <span class="action-icon">🔗</span>
                <span class="action-text">Flash & Monitor</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.load">
                <span class="action-icon">📱</span>
                <span class="action-text">Load via Bootloader</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.load-and-monitor">
                <span class="action-icon">📱</span>
                <span class="action-text">Load via Bootloader & Monitor</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.monitor">
                <span class="action-icon">📺</span>
                <span class="action-text">Monitor</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.update">
                <span class="action-icon">🔄</span>
                <span class="action-text">Update Dependencies</span>
              </button>
              <button class="action-btn tertiary" data-command="zephyr-tools.debug-now">
                <span class="action-icon">🐞</span>
                <span class="action-text">Debug Now</span>
              </button>
            </div>
          </div>

          <!-- Advanced Settings -->
          <div class="card advanced-settings">
            <h3 class="card-title">Advanced Settings</h3>
            <div class="settings-list">
              <div class="setting-item" data-command="zephyr-tools.change-probe-rs-settings">
                <span class="setting-icon">🔧</span>
                <span class="setting-text">Probe-rs Settings</span>
                <span class="setting-arrow">→</span>
              </div>
              <div class="setting-item" data-command="zephyr-tools.setup-newtmgr">
                <span class="setting-icon">📱</span>
                <span class="setting-text">Setup Newtmgr</span>
                <span class="setting-arrow">→</span>
              </div>
              <div class="setting-item" data-command="zephyr-tools.setup-monitor">
                <span class="setting-icon">📺</span>
                <span class="setting-text">Setup Serial Monitor</span>
                <span class="setting-arrow">→</span>
              </div>
            </div>
          </div>
        </div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfigManager, ProjectConfigManager } from "../config";
import { GlobalConfig, ProjectConfig } from "../types";

interface SidebarState {
  type: 'setup-required' | 'project-required' | 'initializing' | 'setup-in-progress' | 'ready';
  config: GlobalConfig;
  project: ProjectConfig;
  hasWorkspace: boolean;
}

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'zephyrToolsSidebar';

  private _view?: vscode.WebviewView;

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
            await vscode.commands.executeCommand(data.command, ...(data.args || []));
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
      const config = await GlobalConfigManager.load(this.context);
      const project = await ProjectConfigManager.load(this.context);
      const state = await this.determineState(config, project);
      
      // Auto-reveal the sidebar when in progress states
      if (state.type === 'initializing' || state.type === 'setup-in-progress') {
        await this.revealSidebar();
      }
      
      this._view.webview.postMessage({
        type: 'update',
        data: {
          state,
          config,
          project
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
    if (!project.isInit) {
      return {
        type: 'project-required',
        config,
        project,
        hasWorkspace
      };
    }
    
    // All good - ready state
    return {
      type: 'ready',
      config,
      project,
      hasWorkspace
    };
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

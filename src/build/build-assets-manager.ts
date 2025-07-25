/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { ProjectConfig } from "../types";

export interface BuildAssetInfo {
  name: string;
  displayName: string;
  path: string;
  exists: boolean;
  size?: number;
  lastModified?: Date;
}

export interface BuildAssetsState {
  hasAssets: boolean;
  assets: BuildAssetInfo[];
  lastBuild?: Date;
  buildPath: string;
}

export class BuildAssetsManager {
  private static readonly ASSET_DEFINITIONS = [
    {
      name: "dfu_application.zip",
      displayName: "DFU Package",
      location: "root" as const,
    },
    {
      name: "dfu_application.zip_manifest.json",
      displayName: "Manifest",
      location: "root" as const,
    },
    {
      name: "merged.hex",
      displayName: "Merged Hex",
      location: "root" as const,
    },
    {
      name: "zephyr.elf",
      displayName: "Zephyr ELF",
      location: "zephyr" as const,
    },
    {
      name: "zephyr.hex",
      displayName: "Zephyr Hex",
      location: "zephyr" as const,
    },
  ];

  /**
   * Get build assets state for the current project configuration
   */
  public static async getBuildAssetsState(project: ProjectConfig): Promise<BuildAssetsState> {
    const buildPath = this.getBuildPath(project);
    const assets: BuildAssetInfo[] = [];
    let hasAssets = false;
    let lastBuild: Date | undefined;

    for (const assetDef of this.ASSET_DEFINITIONS) {
      const assetPath = this.getAssetPath(buildPath, assetDef.name, assetDef.location, project);
      const assetInfo: BuildAssetInfo = {
        name: assetDef.name,
        displayName: assetDef.displayName,
        path: assetPath,
        exists: false,
      };

      try {
        const stats = await fs.stat(assetPath);
        assetInfo.exists = true;
        assetInfo.size = stats.size;
        assetInfo.lastModified = stats.mtime;
        hasAssets = true;

        // Track the most recent build time
        if (!lastBuild || stats.mtime > lastBuild) {
          lastBuild = stats.mtime;
        }
      } catch (error) {
        // File doesn't exist, keep exists: false
      }

      assets.push(assetInfo);
    }

    return {
      hasAssets,
      assets,
      lastBuild,
      buildPath,
    };
  }

  /**
   * Get the build directory path for a project
   */
  public static getBuildPath(project: ProjectConfig): string {
    if (!project.target || !project.board) {
      return "";
    }

    // Extract the base board name (before any slash)
    // e.g., "circuitdojo_feather_nrf9151/nrf9151/ns" -> "circuitdojo_feather_nrf9151"
    const baseBoardName = project.board.split('/')[0];
    
    return path.join(project.target, "build", baseBoardName);
  }

  /**
   * Get the full path to a specific asset
   */
  private static getAssetPath(buildPath: string, assetName: string, location: "root" | "zephyr", project?: ProjectConfig): string {
    if (location === "zephyr") {
      // For zephyr assets, they're typically in build/board/chip/zephyr/
      // e.g., build/circuitdojo_feather_nrf9151/nrf9160/zephyr/
      const chipName = this.extractChipName(project?.board);
      return path.join(buildPath, chipName, "zephyr", assetName);
    }
    return path.join(buildPath, assetName);
  }

  /**
   * Extract chip name from board configuration
   * e.g., "circuitdojo_feather_nrf9151/nrf9151/ns" -> "nrf9160" (based on common patterns)
   */
  private static extractChipName(board?: string): string {
    if (!board) return "zephyr";
    
    // For nRF91 series boards, the chip is typically nrf9160
    if (board.includes('nrf91')) {
      return 'nrf9160';
    }
    
    // For other boards, try to extract from the board path
    const parts = board.split('/');
    if (parts.length > 1) {
      return parts[1]; // Second part is usually the chip
    }
    
    // Default fallback
    return "zephyr";
  }

  /**
   * Format file size in human-readable format
   */
  public static formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  /**
   * Format time relative to now (e.g., "2 min ago")
   */
  public static formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) {
      return "just now";
    } else if (diffMins < 60) {
      return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Watch build directory for changes - optimized to only watch for final build outputs
   */
  public static createFileWatcher(
    project: ProjectConfig,
    onChanged: () => void
  ): vscode.FileSystemWatcher | null {
    const buildPath = this.getBuildPath(project);
    console.log('Creating file watcher for build path:', buildPath);
    
    if (!buildPath) {
      console.log('No build path available, cannot create watcher');
      return null;
    }

    try {
      // Watch the build directory and its subdirectories
      // Use the project target directory to watch for build folder creation
      const watchPath = project.target || '';
      if (!watchPath) {
        console.log('No project target path available');
        return null;
      }
      
      console.log('Setting up file watcher for path:', watchPath);
      
      // Watch only for specific build output files that we care about
      // This reduces the number of events significantly
      const patterns = [
        'build/**/zephyr.elf',
        'build/**/zephyr.hex', 
        'build/**/merged.hex',
        'build/**/dfu_application.zip',
        'build/**/dfu_application.zip_manifest.json'
      ];
      
      const watchers: vscode.FileSystemWatcher[] = [];
      let debounceTimer: NodeJS.Timeout | null = null;
      
      const debouncedChangeHandler = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        
        debounceTimer = setTimeout(() => {
          console.log('Build assets change detected (debounced)');
          onChanged();
          debounceTimer = null;
        }, 2000); // 2 second debounce to let build process complete
      };
      
      // Create watchers for each specific file pattern
      for (const pattern of patterns) {
        try {
          const filePattern = new vscode.RelativePattern(watchPath, pattern);
          console.log(`Creating watcher for pattern: ${pattern} in ${watchPath}`);
          const watcher = vscode.workspace.createFileSystemWatcher(filePattern);
          
          watcher.onDidCreate((uri) => {
            console.log(`File created: ${uri.fsPath}`);
            debouncedChangeHandler();
          });
          watcher.onDidChange((uri) => {
            console.log(`File changed: ${uri.fsPath}`);
            debouncedChangeHandler();
          });
          watcher.onDidDelete((uri) => {
            console.log(`File deleted: ${uri.fsPath}`);
            debouncedChangeHandler();
          });
          
          watchers.push(watcher);
        } catch (error) {
          console.error(`Failed to create watcher for pattern ${pattern}:`, error);
        }
      }
      
      if (watchers.length === 0) {
        console.log('No watchers created');
        return null;
      }
      
      console.log(`File watchers created successfully for ${watchers.length} patterns`);
      
      // Return a composite watcher that disposes all individual watchers
      return {
        dispose: () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          watchers.forEach(w => w.dispose());
        }
      } as vscode.FileSystemWatcher;
      
    } catch (error) {
      console.error("Failed to create file watcher for build assets:", error);
      return null;
    }
  }

  /**
   * Open build folder in file manager
   */
  public static async openBuildFolder(project: ProjectConfig): Promise<void> {
    const buildPath = this.getBuildPath(project);
    
    if (!buildPath || !fs.existsSync(buildPath)) {
      vscode.window.showErrorMessage("Build directory does not exist. Build the project first.");
      return;
    }

    try {
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(buildPath));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open build folder: ${error}`);
    }
  }

  /**
   * Reveal specific build asset file in file manager
   */
  public static async revealBuildAsset(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      vscode.window.showErrorMessage("Build asset file does not exist. The file may have been moved or deleted.");
      return;
    }

    try {
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(filePath));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reveal build asset: ${error}`);
    }
  }
}

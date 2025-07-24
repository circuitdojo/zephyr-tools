/**
 * @file path-manager.ts
 * Handles environment path modifications for the Zephyr Tools.
 * 
 * @license Apache-2.0
 */

import * as vscode from 'vscode';
import { getPlatformConfig } from '../config';
import { GlobalConfig } from '../types';

export class PathManager {
  static restorePaths(config: GlobalConfig, context: vscode.ExtensionContext): void {
    const platformConfig = getPlatformConfig();
    const pathDivider = platformConfig.pathDivider;

    if (config.isSetup && config.env["PATH"] !== undefined) {
      // Handle Windows case sensitivity for PATH environment variable
      const systemPath = process.env.PATH || process.env.Path || process.env.path || "";
      const configPath = config.env["PATH"];

      if (configPath !== systemPath && configPath.length > systemPath.length) {
        const pathDividerIndex = configPath.lastIndexOf(systemPath);
        if (pathDividerIndex > 0) {
          const addedPaths = configPath.substring(0, pathDividerIndex);
          const cleanAddedPaths = addedPaths.endsWith(pathDivider)
            ? addedPaths.substring(0, addedPaths.length - pathDivider.length)
            : addedPaths;

          const individualPaths = cleanAddedPaths.split(pathDivider).filter(p => p.trim());
          for (const pathToAdd of individualPaths.reverse()) {
            context.environmentVariableCollection.prepend("PATH", pathToAdd + pathDivider);
          }
        }
      }
    }
  }
}


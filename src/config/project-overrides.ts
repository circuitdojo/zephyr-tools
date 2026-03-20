/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs-extra";
import * as path from "path";
import { ProjectConfig } from "../types";

const OVERRIDES_FILENAME = ".zephyr-overrides.json";

export interface ProjectOverrides {
  runner?: string;
  runnerParams?: string;
  sysbuild?: boolean;
  extraConfFiles?: string[];
  extraOverlayFiles?: string[];
  extraCMakeDefines?: string[];
}

export class ProjectOverridesManager {
  /**
   * Save overrides for a specific project+board combination.
   * Writes to .zephyr-overrides.json in the project directory.
   */
  static async save(projectTarget: string, board: string, config: ProjectConfig): Promise<void> {
    try {
      const filePath = path.join(projectTarget, OVERRIDES_FILENAME);
      let allOverrides: Record<string, ProjectOverrides> = {};

      // Read existing file if present
      if (await fs.pathExists(filePath)) {
        try {
          const content = await fs.readFile(filePath, "utf-8");
          allOverrides = JSON.parse(content);
        } catch {
          // Corrupt file — start fresh
          allOverrides = {};
        }
      }

      // Extract and save overrides for this board
      allOverrides[board] = ProjectOverridesManager.extractOverrides(config);
      await fs.writeFile(filePath, JSON.stringify(allOverrides, null, 2));
    } catch (e) {
      console.error("Failed to save project overrides:", e);
    }
  }

  /**
   * Load overrides for a specific project+board combination.
   * Returns undefined if file doesn't exist or board has no saved overrides.
   */
  static async load(projectTarget: string, board: string): Promise<ProjectOverrides | undefined> {
    try {
      const filePath = path.join(projectTarget, OVERRIDES_FILENAME);

      if (!await fs.pathExists(filePath)) {
        return undefined;
      }

      const content = await fs.readFile(filePath, "utf-8");
      const allOverrides: Record<string, ProjectOverrides> = JSON.parse(content);
      return allOverrides[board];
    } catch {
      return undefined;
    }
  }

  /**
   * Extract overridable fields from a ProjectConfig.
   */
  static extractOverrides(config: ProjectConfig): ProjectOverrides {
    return {
      runner: config.runner,
      runnerParams: config.runnerParams,
      sysbuild: config.sysbuild,
      extraConfFiles: config.extraConfFiles,
      extraOverlayFiles: config.extraOverlayFiles,
      extraCMakeDefines: config.extraCMakeDefines,
    };
  }

  /**
   * Get all board names that have saved overrides for a project.
   * Returns [] if file doesn't exist or on error.
   */
  static async getBoards(projectTarget: string): Promise<string[]> {
    try {
      const filePath = path.join(projectTarget, OVERRIDES_FILENAME);
      if (!await fs.pathExists(filePath)) {
        return [];
      }
      const content = await fs.readFile(filePath, "utf-8");
      const allOverrides: Record<string, ProjectOverrides> = JSON.parse(content);
      return Object.keys(allOverrides);
    } catch {
      return [];
    }
  }

  /**
   * Apply saved overrides onto a ProjectConfig.
   */
  static applyOverrides(config: ProjectConfig, overrides: ProjectOverrides): void {
    if (overrides.runner !== undefined) { config.runner = overrides.runner; }
    if (overrides.runnerParams !== undefined) { config.runnerParams = overrides.runnerParams; }
    if (overrides.sysbuild !== undefined) { config.sysbuild = overrides.sysbuild; }
    if (overrides.extraConfFiles !== undefined) { config.extraConfFiles = overrides.extraConfFiles; }
    if (overrides.extraOverlayFiles !== undefined) { config.extraOverlayFiles = overrides.extraOverlayFiles; }
    if (overrides.extraCMakeDefines !== undefined) { config.extraCMakeDefines = overrides.extraCMakeDefines; }
  }
}

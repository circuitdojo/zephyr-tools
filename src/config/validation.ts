/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import { GlobalConfig, ProjectConfig } from "../types";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Configuration validation utilities
 */
export class ConfigValidator {
  /**
   * Validates that the global config has a compatible manifest version
   */
  static validateManifestVersion(config: GlobalConfig): boolean {
    const manifest = require("../../manifest/manifest.json");
    return config.manifestVersion === manifest.version;
  }

  /**
   * Validates setup state and manifest version compatibility
   */
  static validateSetupState(config: GlobalConfig): ValidationResult {
    const manifest = require("../../manifest/manifest.json");
    
    if (config.manifestVersion !== manifest.version) {
      return {
        isValid: false,
        error: "An update is required. Run `Zephyr Tools: Setup` command first."
      };
    }
    
    if (!config.isSetup) {
      return {
        isValid: false,
        error: "Run `Zephyr Tools: Setup` command first."
      };
    }
    
    return { isValid: true };
  }

  /**
   * Validates that the project has been properly initialized
   */
  static validateProjectInit(project: ProjectConfig): ValidationResult {
    if (!project.isInit) {
      return {
        isValid: false,
        error: "Run `Zephyr Tools: Init Repo` command first."
      };
    }
    return { isValid: true };
  }

  /**
   * Validates both setup state and project initialization
   */
  static validateSetupAndProject(config: GlobalConfig, project: ProjectConfig): ValidationResult {
    // First check setup state
    const setupValidation = this.validateSetupState(config);
    if (!setupValidation.isValid) {
      return setupValidation;
    }

    // Then check project initialization
    return this.validateProjectInit(project);
  }
}

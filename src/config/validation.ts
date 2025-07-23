/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig, ProjectConfig } from "../types";
import { GlobalConfigManager } from "./global-config";
import { ManifestValidator, ManifestValidationResult } from "./manifest-validator";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  details?: string[];
}

/**
 * Configuration validation utilities with comprehensive manifest checking
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
   * Validates setup state with comprehensive manifest verification
   * Automatically resets setup flag if physical validation fails
   */
  static async validateSetupState(
    config: GlobalConfig, 
    context?: vscode.ExtensionContext,
    performPhysicalValidation: boolean = true
  ): Promise<ValidationResult> {
    const manifest = require("../../manifest/manifest.json");
    
    // Check manifest version first
    if (config.manifestVersion !== manifest.version) {
      return {
        isValid: false,
        error: "An update is required. Run `Zephyr Tools: Setup` command first.",
        details: [`Expected manifest version ${manifest.version}, found ${config.manifestVersion}`]
      };
    }
    
    // Check basic setup flag
    if (!config.isSetup) {
      return {
        isValid: false,
        error: "Run `Zephyr Tools: Setup` command first.",
        details: ["Setup has not been completed"]
      };
    }

    // Perform physical validation if requested and context available
    if (performPhysicalValidation && context) {
      try {
        const physicalValidation = await ManifestValidator.validateCompleteSetup(config);
        
        if (!physicalValidation.isValid) {
          // Reset setup flag due to physical validation failure
          console.log("Physical validation failed, resetting setup flag");
          config.isSetup = false;
          await GlobalConfigManager.save(context, config);
          
          return {
            isValid: false,
            error: "Setup validation failed. Run `Zephyr Tools: Setup` command again.",
            details: [
              "Physical validation detected missing or corrupted components:",
              ...physicalValidation.errors,
              ...physicalValidation.warnings
            ]
          };
        }
        
        // Log warnings but don't fail validation
        if (physicalValidation.warnings.length > 0) {
          console.log("Setup validation warnings:", physicalValidation.warnings);
        }
      } catch (error) {
        console.warn("Physical validation failed with error:", error);
        // Don't fail validation due to validation errors, but log them
        return {
          isValid: true, // Allow to proceed but with warning
          error: undefined,
          details: [`Warning: Could not verify physical setup: ${error}`]
        };
      }
    }
    
    return { isValid: true };
  }

  /**
   * Quick validation without physical checks (for performance-critical paths)
   */
  static validateSetupStateQuick(config: GlobalConfig): ValidationResult {
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
  static async validateSetupAndProject(
    config: GlobalConfig, 
    project: ProjectConfig,
    context?: vscode.ExtensionContext,
    performPhysicalValidation: boolean = false
  ): Promise<ValidationResult> {
    // First check setup state
    const setupValidation = await this.validateSetupState(config, context, performPhysicalValidation);
    if (!setupValidation.isValid) {
      return setupValidation;
    }

    // Then check project initialization
    return this.validateProjectInit(project);
  }

  /**
   * Quick validation of both setup and project (synchronous)
   */
  static validateSetupAndProjectQuick(config: GlobalConfig, project: ProjectConfig): ValidationResult {
    // First check setup state
    const setupValidation = this.validateSetupStateQuick(config);
    if (!setupValidation.isValid) {
      return setupValidation;
    }

    // Then check project initialization
    return this.validateProjectInit(project);
  }
}

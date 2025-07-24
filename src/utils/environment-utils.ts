/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

/**
 * Utility class for handling environment variable normalization across platforms
 */
export class EnvironmentUtils {
  /**
   * Normalizes environment variables for cross-platform compatibility.
   * Ensures PATH is properly set on Windows where it might be 'Path' or 'path'.
   * 
   * @param env - The environment object to normalize
   * @returns Normalized environment with consistent PATH variable
   */
  static normalizeEnvironment(env: NodeJS.ProcessEnv): { [key: string]: string } {
    const normalized = { ...env };
    
    // Handle Windows PATH case sensitivity
    // Windows may use 'Path' while Unix systems use 'PATH'
    if (!normalized.PATH && (normalized.Path || normalized.path)) {
      console.log(`[ENV] Normalizing PATH from ${normalized.Path ? 'Path' : 'path'} to PATH`);
      normalized.PATH = normalized.Path || normalized.path || "";
      
      // Clean up the old entries to avoid confusion
      delete normalized.Path;
      delete normalized.path;
    }
    
    return normalized as { [key: string]: string };
  }
  
  /**
   * Gets normalized system environment with proper PATH handling.
   * This should be used when initializing configuration from system environment.
   * 
   * @returns Normalized system environment variables
   */
  static getSystemEnvironment(): { [key: string]: string } {
    return this.normalizeEnvironment(process.env);
  }
  
  /**
   * Creates shell execution options with normalized environment.
   * Convenience method for commands that need to execute shell processes.
   * 
   * @param env - Environment to normalize
   * @param cwd - Working directory for the shell execution
   * @returns Shell execution options with normalized environment
   */
  static createShellOptions(env: NodeJS.ProcessEnv, cwd?: string): { env: { [key: string]: string }, cwd?: string } {
    const normalizedEnv = this.normalizeEnvironment(env);
    const options: { env: { [key: string]: string }, cwd?: string } = {
      env: normalizedEnv
    };
    
    if (cwd) {
      options.cwd = cwd;
    }
    
    return options;
  }
}

/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

export interface ProjectConfig {
  board?: string;
  target?: string;
  isInit: boolean;
  isInitializing?: boolean; // Track when initialization is in progress
  runner?: string;
  runnerParams?: string;
  sysbuild?: boolean;
  extraConfFiles?: string[]; // Array of relative paths to extra .conf files
  extraOverlayFiles?: string[]; // Array of relative paths to extra .overlay files
}

export interface ZephyrTask {
  name?: string;
  data?: any;
}

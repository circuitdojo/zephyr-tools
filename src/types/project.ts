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
  extraCMakeDefines?: string[]; // Array of KEY=VALUE strings for extra -D defines
  manifest?: string; // West manifest filename (default: west.yml)
  manifestDir?: string; // West manifest repo directory relative to workspace root
}

export interface BuildConfigSnapshot {
  board: string;
  sysbuild: boolean;
  extraConfFiles: string[];
  extraOverlayFiles: string[];
  extraCMakeDefines: string[];
}

export interface ZephyrTask {
  name?: string;
  data?: any;
}

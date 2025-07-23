/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

export interface ProjectConfig {
  board?: string;
  target?: string;
  port?: string;
  isInit: boolean;
  runner?: string;
  runnerParams?: string;
  sysbuild?: boolean;
  probeRsProbeId?: string; // Cached probe identifier for probe-rs flashing
  probeRsChipName?: string; // Cached chip name for probe-rs flashing
  saveSerialLogs?: boolean; // Enable/disable saving serial logs to file (default: false)
}

export interface ZephyrTask {
  name?: string;
  data?: any;
}

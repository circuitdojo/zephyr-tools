/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

export interface GlobalConfig {
  isSetup: boolean;
  isSetupInProgress: boolean;
  manifestVersion: Number;
  env: { [name: string]: string | undefined };
}

export interface ProbeInfo {
  id: string;
  name: string;
  probeId?: string; // The actual probe identifier for --probe flag
  vidPid?: string; // VID:PID information
  serial?: string; // Serial number
  fullDescription?: string; // Full description from probe-rs
}

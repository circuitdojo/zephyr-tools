/**
 * @file probe-manager.ts
 * Handles probe management and detection for the Zephyr Tools.
 * 
 * @license Apache-2.0
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import { ProbeInfo } from '../types';
import { PlatformUtils, EnvironmentUtils } from '../utils';

export class ProbeManager {


  static async getAvailableProbes(configEnv?: { [key: string]: string }): Promise<ProbeInfo[] | null> {
    try {
      const exec = util.promisify(cp.exec);
      const tools = PlatformUtils.getToolExecutables();
      const cmd = `${tools.probeRs} list`;
      
      // Use normalized environment - either from config or system default
      const execEnv = configEnv ? 
        EnvironmentUtils.normalizeEnvironment(configEnv) : 
        EnvironmentUtils.getSystemEnvironment();
      
      console.log(`ProbeManager: About to execute: ${cmd}`);
      console.log(`ProbeManager: PATH in execEnv: ${execEnv.PATH}`);
      console.log(`ProbeManager: Full execEnv:`, JSON.stringify(execEnv, null, 2));
      
      const result = await exec(cmd, { env: execEnv });

      if (result.stderr && result.stderr.trim() !== "") {
        console.error(`probe-rs list stderr: ${result.stderr}`);
      }

      return this.parseProbeRsList(result.stdout);
    } catch (error) {
      console.error(`Error running probe-rs list: ${error}`);
      return null;
    }
  }

  static async selectProbe(probes: ProbeInfo[]): Promise<ProbeInfo | undefined> {
    const probeItems = probes.map((probe, index) => {
      // Build the label with just probe name and ID
      let label = `${probe.name} ID:${index}`;
      
      // Build description with VID:PID:Serial information
      let description = '';
      if (probe.vidPid && probe.serial) {
        description = `${probe.vidPid}:${probe.serial}`;
      } else if (probe.vidPid) {
        description = probe.vidPid;
      } else if (probe.serial) {
        description = `Serial: ${probe.serial}`;
      } else {
        description = `Probe ID: ${probe.id}`;
      }
      
      return {
        label: label,
        description: description,
        detail: `Internal ID: ${probe.id}${probe.probeId ? ` | Probe Identifier: ${probe.probeId}` : ''}`,
        probe: probe
      };
    });

    const selectedItem = await vscode.window.showQuickPick(probeItems, {
      title: "Select debug probe for flashing",
      placeHolder: "Choose which probe to use for flashing...",
      ignoreFocusOut: true,
    });

    return selectedItem?.probe;
  }

  static async getProbeRsChipName(configEnv?: { [key: string]: string }): Promise<string | undefined> {
    try {
      const exec = util.promisify(cp.exec);
      const tools = PlatformUtils.getToolExecutables();
      const cmd = `${tools.probeRs} chip list`;
      
      // Use normalized environment - either from config or system default
      const execEnv = configEnv ? 
        EnvironmentUtils.normalizeEnvironment(configEnv) : 
        EnvironmentUtils.getSystemEnvironment();
      
      console.log(`ProbeManager: About to execute: ${cmd}`);
      console.log(`ProbeManager: PATH in execEnv: ${execEnv.PATH}`);
      
      const result = await exec(cmd, { env: execEnv });

      if (result.stderr) {
        console.error(`Error getting probe-rs chip list: ${result.stderr}`);
        return undefined;
      }

      const chipNames = this.parseProbeRsChipList(result.stdout);

      if (chipNames.length === 0) {
        console.error("No chips found in probe-rs chip list.");
        return undefined;
      }

      return await vscode.window.showQuickPick(chipNames, {
        title: "Select probe-rs target chip",
        placeHolder: "Choose the target chip for flashing...",
        ignoreFocusOut: true,
      });
    } catch (error) {
      console.error(`Error running probe-rs chip list: ${error}`);
      return undefined;
    }
  }

  private static parseProbeRsList(output: string): ProbeInfo[] {
    const lines = output.split('\n');
    const probes: ProbeInfo[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine && (trimmedLine.includes('VID:') || trimmedLine.includes('Serial:') ||
          (trimmedLine.startsWith('[') && trimmedLine.includes(']:')))) {
        const idMatch = trimmedLine.match(/\[([^\]]+)\]/);
        if (idMatch) {
          const id = idMatch[1];
          const descriptionMatch = trimmedLine.match(/\[([^\]]+)\]:\s*(.+)/);
          if (descriptionMatch) {
            const fullDescription = descriptionMatch[2];
            const nameMatch = fullDescription.match(/^([^()]+)/);
            const probeName = nameMatch ? nameMatch[1].trim() : fullDescription;
            // Extract VID:PID information
            const vidPidMatch = fullDescription.match(/VID:\s*([0-9a-fA-F]{4})\s*PID:\s*([0-9a-fA-F]{4})/);
            let vidPid = "";
            if (vidPidMatch) {
              vidPid = `${vidPidMatch[1]}:${vidPidMatch[2]}`;
            }
            
            // Extract serial number
            const serialMatch = fullDescription.match(/Serial:\s*([^,\s)]+)/);
            const serial = serialMatch ? serialMatch[1] : undefined;
            
            // Build probe identifier for --probe flag
            let probeIdentifier: string | undefined;
            
            // First try to find CMSIS-DAP identifier format
            const cmsisMatch = fullDescription.match(/--\s*([0-9a-fA-F:]+)/);
            if (cmsisMatch) {
              probeIdentifier = cmsisMatch[1];
            } else if (vidPid && serial) {
              // Build identifier from VID:PID:Serial for probe-rs
              probeIdentifier = `${vidPid}:${serial}`;
            } else if (serial) {
              // Use just serial if no VID:PID available
              probeIdentifier = serial;
            }
            
            probes.push({ id, name: probeName, probeId: probeIdentifier, fullDescription, vidPid, serial });
          }
        }
      }
    }

    return probes;
  }

  private static parseProbeRsChipList(output: string): string[] {
    const lines = output.split('\n');
    const chipNames: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine && !trimmedLine.endsWith('Series') && !trimmedLine.startsWith('Variants:') &&
          trimmedLine !== 'Variants:' &&
          line.startsWith('        ')) {
        chipNames.push(trimmedLine);
      }
    }

    return chipNames.sort();
  }
}

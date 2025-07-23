/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as util from "util";
import * as cp from "child_process";
import { platform, getPlatformConfig } from "../config";

// Function to find a suitable Python 3.10+ version
export async function findSuitablePython(output: vscode.OutputChannel): Promise<string | null> {
  const exec = util.promisify(cp.exec);
  const platformConfig = getPlatformConfig();

  // List of Python executables to try, in order of preference
  const pythonCandidates = platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"];

  for (const pythonCmd of pythonCandidates) {
    try {
      output.appendLine(`[SETUP] Checking ${pythonCmd}...`);
      const result = await exec(`${pythonCmd} --version`);
      const versionOutput = result.stdout || result.stderr;
      const versionMatch = versionOutput.match(/Python (\d+)\.(\d+)\.(\d+)/);

      if (versionMatch) {
        const major = parseInt(versionMatch[1]);
        const minor = parseInt(versionMatch[2]);
        const version = `${major}.${minor}`;

        output.appendLine(`[SETUP] Found ${pythonCmd}: Python ${version}`);

        // Check if version is 3.10 or higher (including future major versions)
        if ((major === 3 && minor >= 10) || major > 3) {
          output.appendLine(`[SETUP] Python ${version} meets requirements (>= 3.10)`);
          return pythonCmd;
        } else {
          output.appendLine(`[SETUP] Python ${version} is too old (requires >= 3.10)`);
        }
      }
    } catch (error) {
      // Python executable not found or failed to run, continue to next candidate
      output.appendLine(`[SETUP] ${pythonCmd} not found or failed to execute`);
    }
  }

  output.appendLine("[SETUP] No suitable Python 3.10+ version found");
  return null;
}

export async function validatePythonInstallation(pythonCmd: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  try {
    const cmd = `${pythonCmd} --version`;
    output.appendLine(cmd);
    const result = await exec(cmd, { env });
    
    if (result.stdout.includes("Python 3")) {
      output.appendLine("[SETUP] python3 found");
      return true;
    } else {
      output.appendLine("[SETUP] python3 not found");
      showPythonInstallInstructions(output);
      return false;
    }
  } catch (error) {
    output.appendLine("[SETUP] python validation failed");
    showPythonInstallInstructions(output);
    return false;
  }
}

export async function validatePipInstallation(pythonCmd: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  try {
    const cmd = `${pythonCmd} -m pip --version`;
    output.appendLine(cmd);
    const result = await exec(cmd, { env });
    output.append(result.stdout);
    output.append(result.stderr);
    output.appendLine("[SETUP] pip installed");
    return true;
  } catch (error) {
    output.appendLine("[SETUP] pip validation failed");
    showPipInstallInstructions(output);
    return false;
  }
}

export async function validateVenvSupport(pythonCmd: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  try {
    const cmd = `${pythonCmd} -m venv --help`;
    output.appendLine(cmd);
    await exec(cmd, { env });
    output.appendLine("[SETUP] python3 venv OK");
    return true;
  } catch (error) {
    output.appendLine("[SETUP] venv validation failed");
    showVenvInstallInstructions(output);
    return false;
  }
}

function showPythonInstallInstructions(output: vscode.OutputChannel): void {
  switch (platform) {
    case "darwin":
      output.appendLine("[SETUP] use `brew` to install `python3`");
      output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
      output.appendLine("[SETUP] Then run `brew install python3`");
      break;
    case "linux":
      output.appendLine("[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`");
      break;
    default:
      break;
  }
}

function showPipInstallInstructions(output: vscode.OutputChannel): void {
  switch (platform) {
    case "linux":
      output.appendLine("[SETUP] please install `python3.10-pip` package (or newer)");
      break;
    default:
      output.appendLine("[SETUP] please install `python3` with `pip` support");
      break;
  }
}

function showVenvInstallInstructions(output: vscode.OutputChannel): void {
  switch (platform) {
    case "linux":
      output.appendLine("[SETUP] please install `python3.10-venv` package (or newer)");
      break;
    default:
      output.appendLine("[SETUP] please install `python3` with `venv` support");
      break;
  }
}

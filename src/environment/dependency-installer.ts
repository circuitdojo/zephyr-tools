/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as util from "util";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { platform, getPlatformConfig, SettingsManager } from "../config";

export async function createVirtualEnvironment(pythonCmd: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);
  const currentToolsDir = SettingsManager.getToolsDirectory();
  const pythonenv = path.join(currentToolsDir, "env");

  if (fs.existsSync(pythonenv)) {
    const venvPython = platform === "win32"
      ? path.join(pythonenv, "Scripts", "python.exe")
      : path.join(pythonenv, "bin", "python");

    if (fs.existsSync(venvPython)) {
      output.appendLine(`[SETUP] Existing virtual environment found at ${pythonenv}, upgrading in place...`);
      try {
        const result = await exec(`${pythonCmd} -m venv --upgrade "${pythonenv}"`, { env });
        output.append(result.stdout);
        output.appendLine("[SETUP] Virtual environment upgraded");
        return true;
      } catch (error) {
        output.appendLine(`[SETUP] Upgrade failed (${error}), recreating virtual environment...`);
      }
    } else {
      output.appendLine("[SETUP] Virtual environment is broken, recreating...");
    }

    try {
      fs.rmSync(pythonenv, { recursive: true, force: true });
    } catch (error) {
      output.appendLine(`[SETUP] Failed to remove old virtual environment: ${error}`);
      output.appendLine("[SETUP] Please manually delete: " + pythonenv);
      return false;
    }
  }

  try {
    const cmd = `${pythonCmd} -m venv "${pythonenv}"`;
    output.appendLine(cmd);
    const result = await exec(cmd, { env });
    output.append(result.stdout);
    output.appendLine("[SETUP] Virtual environment created");
    return true;
  } catch (error) {
    output.appendLine("[SETUP] Unable to create virtual environment");
    output.appendLine(`[SETUP] Error: ${error}`);
    console.error(error);
    return false;
  }
}

export async function installWest(pythonCmd: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  try {
    const result = await exec(`${pythonCmd} -m pip install west`, { env });
    output.append(result.stdout);
    output.append(result.stderr);
    output.appendLine("[SETUP] west installed");
    return true;
  } catch (error) {
    output.appendLine("[SETUP] unable to install west");
    output.append(JSON.stringify(error));
    return false;
  }
}

export async function setupVirtualEnvironmentPaths(env: { [key: string]: string | undefined }, context: vscode.ExtensionContext): Promise<void> {
  const currentToolsDir = SettingsManager.getToolsDirectory();
  const pythonenv = path.join(currentToolsDir, "env");
  const platformConfig = getPlatformConfig();
  const pathDivider = platformConfig.pathDivider;

  // Set VIRTUAL_ENV path otherwise we get terribly annoying errors setting up
  env["VIRTUAL_ENV"] = pythonenv;
  
  // Save VIRTUAL_ENV to settings
  await SettingsManager.setVirtualEnv(pythonenv);

  // Add Python paths to VS Code environment
  context.environmentVariableCollection.prepend("PATH", path.join(pythonenv, "Scripts") + pathDivider);
  context.environmentVariableCollection.prepend("PATH", path.join(pythonenv, "bin") + pathDivider);
}

/**
 * Path to the workspace's virtual-environment Python interpreter.
 */
export function getVenvPython(): string {
  const pythonenv = path.join(SettingsManager.getToolsDirectory(), "env");
  return platform === "win32"
    ? path.join(pythonenv, "Scripts", "python.exe")
    : path.join(pythonenv, "bin", "python");
}

/**
 * Detects whether the active west provides the `packages` extension command
 * (Zephyr >= 3.6 / NCS >= 2.6). This command must be run from within the
 * initialized workspace so west can resolve the manifest's extension commands.
 */
export async function westSupportsPackages(
  env: { [key: string]: string | undefined },
  cwd: string
): Promise<boolean> {
  const exec = util.promisify(cp.exec);
  try {
    await exec("west packages pip --help", { env, cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the shell command used to (re)install the Zephyr tree's Python
 * requirements.
 *
 * Prefers `west packages pip --install`, which collects requirements across every
 * west module (zephyr, nrf, mcuboot, etc.) and tracks whatever the current tree
 * needs. Falls back to installing `zephyr/scripts/requirements.txt` directly on
 * trees too old to provide the `west packages` extension command.
 *
 * @param zephyrBase Path to the Zephyr base (absolute, or relative to `cwd`).
 */
export async function getRequirementsInstallCommand(
  zephyrBase: string,
  env: { [key: string]: string | undefined },
  cwd: string
): Promise<string> {
  if (await westSupportsPackages(env, cwd)) {
    return "west packages pip --install";
  }

  const requirementsPath = path.join(zephyrBase, "scripts", "requirements.txt");
  return `"${getVenvPython()}" -m pip install -r "${requirementsPath}"`;
}

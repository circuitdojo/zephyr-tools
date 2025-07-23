/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as util from "util";
import * as cp from "child_process";
import * as path from "path";
import { toolsDir, platform, getPlatformConfig } from "../config";

export async function createVirtualEnvironment(pythonCmd: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);
  const pythonenv = path.join(toolsDir, "env");

  try {
    const cmd = `${pythonCmd} -m venv "${pythonenv}"`;
    output.appendLine(cmd);
    const result = await exec(cmd, { env });
    output.append(result.stdout);
    output.appendLine("[SETUP] virtual python environment created");
    return true;
  } catch (error) {
    output.appendLine("[SETUP] unable to setup virtualenv");
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

export function setupVirtualEnvironmentPaths(env: { [key: string]: string | undefined }, context: vscode.ExtensionContext): void {
  const pythonenv = path.join(toolsDir, "env");
  const platformConfig = getPlatformConfig();
  const pathDivider = platformConfig.pathDivider;

  // Set VIRTUAL_ENV path otherwise we get terribly annoying errors setting up
  env["VIRTUAL_ENV"] = pythonenv;

  // Add env/bin to path
  env["PATH"] = path.join(pythonenv, `Scripts${pathDivider}` + env["PATH"]);
  env["PATH"] = path.join(pythonenv, `bin${pathDivider}` + env["PATH"]);

  // Add Python paths to VS Code environment
  context.environmentVariableCollection.prepend("PATH", path.join(pythonenv, "Scripts") + pathDivider);
  context.environmentVariableCollection.prepend("PATH", path.join(pythonenv, "bin") + pathDivider);
}

export async function installPythonDependencies(pythonCmd: string, zephyrBasePath: string, env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);
  const pythonenv = path.join(toolsDir, "env");
  
  const venvPython = platform === "win32" 
    ? path.join(pythonenv, "Scripts", "python.exe") 
    : path.join(pythonenv, "bin", "python");
    
  const requirementsPath = path.join(zephyrBasePath, "scripts", "requirements.txt");
  const cmd = `"${venvPython}" -m pip install -r ${requirementsPath}`;
  
  try {
    output.appendLine(`[INIT] Starting pip install: ${cmd}`);
    const result = await exec(cmd, { env });
    output.append(result.stdout);
    output.append(result.stderr);
    output.appendLine("[INIT] Python dependencies installed");
    return true;
  } catch (error) {
    output.appendLine("[INIT] Failed to install Python dependencies");
    output.append(String(error));
    return false;
  }
}

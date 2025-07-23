/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as util from "util";
import * as cp from "child_process";
import { platform } from "../config";

export async function validateGitInstallation(env: { [key: string]: string | undefined }, output: vscode.OutputChannel): Promise<boolean> {
  const exec = util.promisify(cp.exec);

  try {
    const result = await exec("git --version", { env });
    output.append(result.stdout);
    output.append(result.stderr);
    output.appendLine("[SETUP] git installed");
    return true;
  } catch (error) {
    output.appendLine("[SETUP] git is not found");
    output.append(String(error));
    showGitInstallInstructions(output);
    return false;
  }
}

function showGitInstallInstructions(output: vscode.OutputChannel): void {
  switch (platform) {
    case "darwin":
      output.appendLine("[SETUP] use `brew` to install `git`");
      output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
      output.appendLine("[SETUP] Then run `brew install git`");
      break;
    case "linux":
      output.appendLine("[SETUP] refer to your distros preferred `git` install method.");
      break;
    default:
      break;
  }
}

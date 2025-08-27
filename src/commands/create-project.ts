/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";
import * as cp from "child_process";
import { GlobalConfig } from "../types";
import { DialogManager } from "../ui";
import { initRepoCommand } from "./project-management";
import { SettingsManager } from "../config/settings-manager";

async function copyFilesRecursively(source: string, destination: string) {
  const files = fs.readdirSync(source);
  for (const file of files) {
    const sourcePath = path.join(source, file);
    const destinationPath = path.join(destination, file);
    console.log("target: " + destinationPath);
    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
      console.log("making dir: " + destinationPath);

      let exists = await fs.pathExists(destinationPath);
      if (!exists) {
        fs.mkdirSync(destinationPath);
      }

      await copyFilesRecursively(sourcePath, destinationPath);
    } else if (!fs.existsSync(destinationPath)) {
      console.log("copying file: " + destinationPath);
      const contents = fs.readFileSync(sourcePath, "utf8");
      fs.writeFileSync(destinationPath, contents, "utf8");
    }
  }
}

export async function createProjectCommand(
  context: vscode.ExtensionContext,
  config: GlobalConfig,
  _dest: vscode.Uri | undefined
): Promise<void> {
  // Get destination, prompting user if not provided (same behavior as init-repo)
  const dest = await DialogManager.getDestination(_dest);
  if (!dest) {
    // Error message already shown by getDestination if user cancelled
    return;
  }

  // Check if .west folder exists in destination - project must be in clean/empty folder
  const westFolderPath = path.join(dest.fsPath, ".west");
  const westFolderExists = await fs.pathExists(westFolderPath);
  if (westFolderExists) {
    vscode.window.showErrorMessage("Cannot create project: .west folder found. Target folder must be clean/empty.");
    return;
  }

  // Merge path
  const appDest = path.join(dest.fsPath, "app");

  console.log("dest: " + appDest);

  // Create app folder
  const exists = await fs.pathExists(appDest);
  if (!exists) {
    console.log(`${appDest} not found`);
    await fs.mkdirp(appDest);
  }

  // Popup asking for which SDK (vanilla vs NCS vs NFED)
  const choices = ["Vanilla", "NRF Connect SDK", "NFED (Circuit Dojo Boards)"];
  const templates = ["vanilla", "ncs", "nfed"];
  const sdk = await vscode.window.showQuickPick(choices, {
    title: "Pick your Zephyr SDK variant.",
    placeHolder: choices[0],
    ignoreFocusOut: true,
  }) ?? choices[0];

  let templateSubPath = "";
  for (let i = 0; i < choices.length; i++) {
    if (choices[i] === sdk) {
      templateSubPath = templates[i];
    }
  }

  if (templateSubPath === "") {
    vscode.window.showErrorMessage("Invalid SDK choice.");
    return;
  }

  // Get the static files
  const extensionPath = context.extensionPath;
  await copyFilesRecursively(path.join(extensionPath, "templates", templateSubPath), appDest);

  // Promisified exec
  const exec = util.promisify(cp.exec);

  // Init git repo
  await exec("git init " + appDest, { env: SettingsManager.buildEnvironmentForExecution() });

  // West init
  const initCmd = `west init -l ${appDest}`;
  await exec(initCmd, { env: SettingsManager.buildEnvironmentForExecution(), cwd: dest.fsPath });

  console.log("init_cmd: " + initCmd);

  // Init the rest of the way
  await initRepoCommand(config, context, dest);
}

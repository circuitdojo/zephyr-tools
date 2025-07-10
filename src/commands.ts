/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as cp from "child_process";
import * as util from "util";
import * as os from "os";
import * as fs from "fs-extra";
import * as path from "path";
import * as unzip from "node-stream-zip";

import * as extension from "./extension";
import * as helper from "./helper";

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

export async function create_new(
  context: vscode.ExtensionContext,
  config: extension.GlobalConfig,
  _dest: vscode.Uri | undefined,
) {
  // Pop up asking for location
  let dest = await helper.get_dest(_dest);

  if (dest === null || dest === undefined || dest.toString() === "") {
    vscode.window.showErrorMessage("Invalid destination");
    return;
  }

  // Merge path
  let app_dest = path.join(dest.fsPath, "app");

  console.log("dest: " + app_dest);

  // Create app folder
  let exists = await fs.pathExists(app_dest);
  if (!exists) {
    console.log(`${app_dest} not found`);
    // Otherwise create home directory
    await fs.mkdirp(app_dest);
  }

  // Popup asking for which SDK (vanilla vs NCS)
  const choices = ["Vanilla", "NRF Connect SDK"];
  const templates = ["vanilla", "ncs"];
  const sdk =
    (await vscode.window.showQuickPick(choices, {
      title: "Pick your Zephyr SDK variant.",
      placeHolder: choices[0],
      ignoreFocusOut: true,
    })) ?? choices[0];

  let templateSubPath = "";
  for (let i = 0; i < choices.length; i++) {
    if (choices[i] === sdk) {
      templateSubPath = templates[i];
    }
  }

  if (templateSubPath === "") {
    vscode.window.showErrorMessage("Invalid SDK choice.");
    return undefined;
  }

  // Get the static files
  const extensionPath = context.extensionPath;
  copyFilesRecursively(path.join(extensionPath, "templates", templateSubPath), app_dest);

  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Init git repo
  await exec("git init " + app_dest, { env: config.env });

  // West init
  let init_cmd = `west init -l ${app_dest}`;
  await exec(init_cmd, { env: config.env });

  console.log("init_cmd: " + init_cmd);

  // Init the rest of the way
  await extension.initRepo(config, context, dest);
}

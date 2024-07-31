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
import * as sevenzip from "7zip-bin";
import * as node7zip from "node-7z";
import * as yaml from "yaml";

import { TaskManager } from "./taskmanager";
import { FileDownload } from "./download";
import * as commands from "./commands";
import * as helper from "./helper";

type ManifestEnvEntry = {
  name: string;
  value?: string;
  usepath: boolean;
  append: boolean;
  suffix?: string;
};

type CmdEntry = {
  cmd: string;
  usepath: boolean;
};

type ManifestToolchainEntry = {
  name: string;
  downloads: ManifestDownloadEntry[];
};

type ManifestDownloadEntry = {
  name: string;
  url: string;
  md5: string;
  suffix?: string;
  env?: ManifestEnvEntry[];
  cmd?: CmdEntry[];
  filename: string;
  clear_target?: boolean;
  copy_to_subfolder?: string;
};

type ManifestEntry = {
  arch: string;
  toolchains: ManifestToolchainEntry[];
  downloads: ManifestDownloadEntry[];
};

type Manifest = {
  version: Number;
  win32: ManifestEntry[];
  darwin: ManifestEntry[];
  linux: ManifestEntry[];
};

// Manifest data
const manifest: Manifest = require("../manifest/manifest.json");

// Platform
let platform: NodeJS.Platform = os.platform();

// Arch
let arch: string = os.arch();

// Platform dependant variables
let toolsfoldername = ".zephyrtools";
let python = "python3";
let pathdivider = ":";
let which = "which";

switch (platform) {
  case "win32":
    python = "python";
    pathdivider = ";";
    which = "where";
    break;
  default:
    break;
}

// Baud list
let baudlist = ["1000000", "115200"];

// Important directories
let toolsdir = path.join(os.homedir(), toolsfoldername);

// Project specific configuration
export interface ProjectConfig {
  board?: string;
  target?: string;
  port?: string;
  isInit: boolean;
  runner?: string;
  runnerParams?: string;
  sysbuild?: boolean;
}

// Config for the exention
export interface GlobalConfig {
  isSetup: boolean;
  manifestVersion: Number;
  env: { [name: string]: string | undefined };
}

// Pending Task
interface ZephyrTask {
  name?: string;
  data?: any;
}

// Output Channel
let output: vscode.OutputChannel;

// Configuratoin
let config: GlobalConfig;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Init task manager
  TaskManager.init();

  // Get the configuration
  config = context.globalState.get("zephyr.env") ?? {
    env: process.env,
    manifestVersion: 0,
    isSetup: false,
  };

  // Then set the application environment to match
  if (config.env["PATH"] !== undefined && config.env["PATH"] !== "") {
    context.environmentVariableCollection.persistent = true;
    context.environmentVariableCollection.replace("PATH", config.env["PATH"]);
  }

  // Create new
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.create-project", async (dest: vscode.Uri | undefined) => {
      await commands.create_new(context, config, dest);
    })
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup", async () => {
      // Reset "zephyr.env"
      context.globalState.update("zephyr.task", undefined);
      context.globalState.update("zephyr.env", undefined);
      config.isSetup = false;
      config.env = {};
      config.env["PATH"] = process.env["PATH"];

      // Show setup progress..
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Setting up Zephyr dependencies",
          cancellable: false,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            TaskManager.cancel();
            console.log("User canceled the long running operation");
          });

          // Create & clear output
          if (output === undefined) {
            output = vscode.window.createOutputChannel("Zephyr Tools");
          }

          // Clear output before beginning
          output.clear();
          output.show();

          // check if directory in $HOME exists
          let exists = await fs.pathExists(toolsdir);
          if (!exists) {
            console.log("toolsdir not found");
            // Otherwise create home directory
            await fs.mkdirp(toolsdir);
          }

          // Promisified exec
          let exec = util.promisify(cp.exec);

          progress.report({ increment: 5 });

          // Define what manifest to use
          let platformManifest: ManifestEntry[] | undefined;
          switch (platform) {
            case "darwin":
              platformManifest = manifest.darwin;
              break;
            case "linux":
              platformManifest = manifest.linux;
              break;
            case "win32":
              platformManifest = manifest.win32;
              break;
          }

          // Skip out if not found
          if (platformManifest === undefined) {
            vscode.window.showErrorMessage("Unsupported platform for Zephyr Tools!");
            return;
          }

          // Set up downloader path
          FileDownload.init(path.join(toolsdir, "downloads"));

          // For loop to process entry in manifest.json
          for (const [index, element] of platformManifest.entries()) {
            // Confirm it's the correct architecture
            if (element.arch === arch) {
              // Get each "name" entry and present as choice to user
              let choices: string[] = [];
              for (let entry of element.toolchains) {
                choices.push(entry.name);
              }

              // Pick options
              const pickOptions: vscode.QuickPickOptions = {
                ignoreFocusOut: true,
                placeHolder: "Which toolchain would you like to install?",
              };

              // Prompt user
              let selection = await vscode.window.showQuickPick(choices, pickOptions);

              // Check if user canceled
              if (selection === undefined) {
                // Show error
                vscode.window.showErrorMessage("Zephyr Tools Setup canceled.");
                return;
              }

              // Find the correct entry
              let entry = element.toolchains.find(element => element.name === selection);

              // Check if it exists
              if (entry === undefined) {
                vscode.window.showErrorMessage("Unable to find toolchain entry.");
                return;
              }

              for (var download of element.downloads) {
                // Process download entry
                let res = await process_download(download, context);
                if (!res) {
                  vscode.window.showErrorMessage("Error downloading files. Check output for more info.");
                  return;
                }
                progress.report({ increment: 5 });
              }

              // Output indicating toolchain install
              output.appendLine(`[SETUP] Installing ${entry.name} toolchain...`);

              for (var download of entry.downloads) {
                // Process download entry
                let res = await process_download(download, context);
                if (!res) {
                  vscode.window.showErrorMessage("Error downloading toolchain. Check output for more info.");
                  return;
                }
                progress.report({ increment: 5 });
              }

              break;
            } else {
              // Check if we're at the end of arch check
              if (index === platformManifest.length - 1) {
                vscode.window.showErrorMessage("Unsupported architecture for Zephyr Tools!");
                return;
              }
            }
          }

          progress.report({ increment: 5 });

          // Check if Git exists in path
          let res: boolean = await exec("git --version", {
            env: config.env,
          }).then(
            value => {
              output.append(value.stdout);
              output.append(value.stderr);
              output.appendLine("[SETUP] git installed");
              return true;
            },
            reason => {
              output.appendLine("[SETUP] git is not found");
              output.append(reason);

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

              // Error message
              vscode.window.showErrorMessage("Unable to continue. Git not installed. Check output for more info.");
              return false;
            }
          );

          // Return if error
          if (!res) {
            return;
          }

          progress.report({ increment: 5 });

          // Otherwise, check Python install
          let cmd = `${python} --version`;
          output.appendLine(cmd);
          res = await exec(cmd, { env: config.env }).then(
            value => {
              if (value.stdout.includes("Python 3")) {
                output.appendLine("[SETUP] python3 found");
              } else {
                output.appendLine("[SETUP] python3 not found");

                switch (platform) {
                  case "darwin":
                    output.appendLine("[SETUP] use `brew` to install `python3`");
                    output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
                    output.appendLine("[SETUP] Then run `brew install python3`");
                    break;
                  case "linux":
                    output.appendLine(
                      "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`"
                    );
                    break;
                  default:
                    break;
                }

                vscode.window.showErrorMessage("Error finding python. Check output for more info.");
                return false;
              }

              return true;
            },
            reason => {
              output.append(reason.stderr);
              console.error(reason);

              // Error message
              switch (platform) {
                case "darwin":
                  output.appendLine("[SETUP] use `brew` to install `python3`");
                  output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
                  output.appendLine("[SETUP] Then run `brew install python3`");
                  break;
                case "linux":
                  output.appendLine(
                    "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`"
                  );
                  break;
                default:
                  break;
              }
              return false;
            }
          );

          // Return if error
          if (!res) {
            return;
          }

          progress.report({ increment: 5 });

          // Check for `pip`
          cmd = `${python} -m pip --version`;
          output.appendLine(cmd);
          res = await exec(cmd, { env: config.env }).then(
            value => {
              output.append(value.stdout);
              output.append(value.stderr);
              output.appendLine("[SETUP] pip installed");
              return true;
            },
            reason => {
              output.append(reason.stderr);
              console.error(reason);

              // Error message

              // Error message
              switch (platform) {
                case "linux":
                  output.appendLine("[SETUP] please install `python3.10-pip` package (or newer)");
                  break;
                default:
                  output.appendLine("[SETUP] please install `python3` with `pip` support");
                  break;
              }
              return false;
            }
          );

          // Return if error
          if (!res) {
            return;
          }

          progress.report({ increment: 5 });

          // create virtualenv within `$HOME/.zephyrtools`
          let pythonenv = path.join(toolsdir, "env");

          // Check if venv is available
          cmd = `${python} -m venv --help`;
          output.appendLine(cmd);
          res = await exec(cmd, { env: config.env }).then(
            value => {
              output.appendLine("[SETUP] python3 venv OK");
              return true;
            },
            reason => {
              output.append(reason.stderr);
              console.error(reason);

              // Error message
              switch (platform) {
                case "linux":
                  output.appendLine("[SETUP] please install `python3.10-venv` package (or newer)");
                  break;
                default:
                  output.appendLine("[SETUP] please install `python3` with `venv` support");
                  break;
              }

              return false;
            }
          );

          // Return if error
          if (!res) {
            return;
          }

          // Then create the virtualenv
          cmd = `${python} -m venv "${pythonenv}"`;
          output.appendLine(cmd);
          res = await exec(cmd, { env: config.env }).then(
            value => {
              output.append(value.stdout);
              output.appendLine("[SETUP] virtual python environment created");
              return true;
            },
            reason => {
              output.appendLine("[SETUP] unable to setup virtualenv");
              console.error(reason);

              // Error message
              vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
              return false;
            }
          );

          // Return if error
          if (!res) {
            return;
          }

          // Report progress
          progress.report({ increment: 5 });

          // Set VIRTUAL_ENV path otherwise we get terribly annoying errors setting up
          config.env["VIRTUAL_ENV"] = pythonenv;

          // Add env/bin to path
          config.env["PATH"] = path.join(pythonenv, `Scripts${pathdivider}` + config.env["PATH"]);
          config.env["PATH"] = path.join(pythonenv, `bin${pathdivider}` + config.env["PATH"]);

          // Install `west`
          res = await exec(`${python} -m pip install west`, {
            env: config.env,
          }).then(
            value => {
              output.append(value.stdout);
              output.append(value.stderr);
              output.appendLine("[SETUP] west installed");
              return true;
            },
            reason => {
              output.appendLine("[SETUP] unable to install west");
              output.append(JSON.stringify(reason));

              // Error message
              vscode.window.showErrorMessage("Error installing west. Check output for more info.");
              return false;
            }
          );

          // Return if error
          if (!res) {
            return;
          }

          output.appendLine("[SETUP] Zephyr setup complete!");

          // Save manifest to the .zephyrtools root
          config.manifestVersion = manifest.version;

          // Setup flag complete
          config.isSetup = true;

          // Save this informaiton to disk
          context.globalState.update("zephyr.env", config);

          // TODO: Then set the application environment to match
          if (config.env["PATH"] !== undefined && config.env["PATH"] !== "") {
            context.environmentVariableCollection.replace("PATH", config.env["PATH"]);
          }

          progress.report({ increment: 100 });

          vscode.window.showInformationMessage(`Zephyr Tools setup complete!`);
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.init-repo", async (_dest: vscode.Uri | undefined) => {
      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Get destination
      let dest = await helper.get_dest(_dest);

      // See if config is set first
      if (config.isSetup && dest != null) {
        initRepo(config, context, dest);
      } else {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
        return;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-project", async () => {
      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // See if config is set first
      if (config.isSetup) {
        changeProject(config, context);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-board", async () => {
      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // See if config is set first
      if (config.isSetup) {
        changeBoard(config, context);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup-monitor", async () => {
      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Get serial settings
      let port = await getPort();
      if (port === undefined) {
        vscode.window.showErrorMessage("Error obtaining serial port.");
        return;
      }

      // Set port in project
      project.port = port;
      await context.workspaceState.update("zephyr.project", project);

      // Message output
      vscode.window.showInformationMessage(`Serial monitor set to use ${project.port}`);
    })
  );

  // Does a pristine zephyr build
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build-pristine", async () => {
      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      if (config.isSetup && project.isInit) {
        await build(config, project, true, context);
      } else if (!project.isInit) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Init Repo` command first.");
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
      }
    })
  );

  // Utilizes build cache (if it exists) and builds
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Do some work
      if (config.isSetup && project.isInit) {
        await build(config, project, false, context);
      } else if (!project.isInit) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Init Repo` command first.");
      } else {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
      }
    })
  );

  // Flashes Zephyr project to board
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Flash board
      if (config.isSetup) {
        await flash(config, project);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before flashing.");
      }
    })
  );

  // Cleans the project by removing the `build` folder
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.clean", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Flash board
      if (config.isSetup) {
        await clean(config, project);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command before flashing.");
      }
    })
  );

  // Update dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.update", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Make sure we're setup first otherwise update
      if (config.isSetup) {
        await update(config, project);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before flashing.");
      }
    })
  );

  // TODO: command for loading via `newtmgr/mcumgr`
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.load", async () => {
      // Cancel all pending tasks
      await TaskManager.cancel();

      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Make sure we're setup first
      if (!config.isSetup) {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before loading.");
        return;
      }

      // Create & clear output
      if (output === undefined) {
        output = vscode.window.createOutputChannel("Zephyr Tools");
      }

      // Clear output before beginning
      output.clear();
      output.show();

      // Get the root path of the workspace
      let rootPath = getRootPath();
      if (rootPath === undefined) {
        vscode.window.showErrorMessage("Unable to get root path.");
        return;
      }

      // Promisified exec
      let exec = util.promisify(cp.exec);

      // Run `newtmgr conn show` to see if there is a profile called "vscode-zephyr-tools"
      let cmd = "newtmgr conn show";
      let res = await exec(cmd, { env: config.env });
      if (res.stderr) {
        output.append(res.stderr);
        output.show();
        return;
      }

      // Kick them back if it doesn't exist
      if (!res.stdout.includes("vscode-zephyr-tools")) {
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup Newtmgr` before loading.");
        return;
      }

      // Otherwise load with app_update.bin
      await load(config, project);
    })
  );

  // TODO: command for loading via `newtmgr/mcumgr`
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.load-and-monitor", async () => {
      // Cancel all pending tasks
      await TaskManager.cancel();

      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Make sure we're setup first
      if (!config.isSetup) {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before loading.");
        return;
      }

      // Create & clear output
      if (output === undefined) {
        output = vscode.window.createOutputChannel("Zephyr Tools");
      }

      // Clear output before beginning
      output.clear();
      output.show();

      // Get the root path of the workspace
      let rootPath = getRootPath();
      if (rootPath === undefined) {
        vscode.window.showErrorMessage("Unable to get root path.");
        return;
      }

      // Promisified exec
      let exec = util.promisify(cp.exec);

      // Run `newtmgr conn show` to see if there is a profile called "vscode-zephyr-tools"
      let cmd = "newtmgr conn show";
      let res = await exec(cmd, { env: config.env });
      if (res.stderr) {
        output.append(res.stderr);
        output.show();
        return;
      }

      // Kick them back if it doesn't exist
      if (!res.stdout.includes("vscode-zephyr-tools")) {
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup Newtmgr` before loading.");
        return;
      }

      // Otherwise load with app_update.bin
      await load(config, project);

      // Set port if necessary
      if (project.port === undefined) {
        // Get serial settings
        project.port = await getPort();
        if (project.port === undefined) {
          vscode.window.showErrorMessage("Error obtaining serial port.");
          return;
        }

        // Save settings
        await context.workspaceState.update("zephyr.project", project);
      }

      await monitor(config, project);
    })
  );

  // Update dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.monitor", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Check if setup
      if (!config.isSetup) {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before loading.");
        return;
      }

      // Set port if necessary
      if (project.port === undefined) {
        // Get serial settings
        project.port = await getPort();
        if (project.port === undefined) {
          vscode.window.showErrorMessage("Error obtaining serial port.");
          return;
        }

        // Save settings
        await context.workspaceState.update("zephyr.project", project);
      }

      await monitor(config, project);
    })
  );

  // Command for flashing and monitoring
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash-and-monitor", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Flash board
      if (config.isSetup) {
        await flash(config, project);

        // Set port if necessary
        if (project.port === undefined) {
          // Get serial settings
          project.port = await getPort();
          if (project.port === undefined) {
            vscode.window.showErrorMessage("Error obtaining serial port.");
            return;
          }

          // Save settings
          await context.workspaceState.update("zephyr.project", project);
        }

        await monitor(config, project);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before flashing.");
      }
    })
  );

  // Command for changing whether or not to use sysbuild
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-sysbuild", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // See if config is set first
      if (config.isSetup) {
        changeSysBuild(config, context);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command first.");
      }
    })
  );

  // Command for changing runner and params
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-runner", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // See if config is set first
      if (config.isSetup) {
        changeRunner(config, context);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command first.");
      }
    })
  );

  // Command for setting up `newtmgr/mcumgr`
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup-newtmgr", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Check if setup
      if (!config.isSetup) {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Toools: Setup` command before loading.");
        return;
      }

      // Promisified exec
      let exec = util.promisify(cp.exec);

      // Get serial settings
      let port = await getPort();
      if (port === undefined) {
        vscode.window.showErrorMessage("Error obtaining serial port.");
        return;
      }

      let baud = await getBaud("1000000");
      if (baud === undefined) {
        vscode.window.showErrorMessage("Error obtaining serial baud.");
        return;
      }

      // Set port in project
      project.port = port;
      await context.workspaceState.update("zephyr.project", project);

      // Create a vscode-tools connection profile
      let cmd = `newtmgr conn add vscode-zephyr-tools type=serial connstring="dev=${port},baud=${baud}"`;
      let res = await exec(cmd, { env: config.env });
      if (res.stderr) {
        output.append(res.stderr);
        output.show();
        return;
      }

      vscode.window.showInformationMessage("Newtmgr successfully configured.");
    })
  );

  // Check if there's a task to run
  let task: ZephyrTask | undefined = context.globalState.get("zephyr.task");
  if (task !== undefined && task.name !== undefined) {
    console.log("Run task! " + JSON.stringify(task));

    context.globalState.update("zephyr.task", undefined);
    await vscode.commands.executeCommand(task.name, task.data);
  }
}

export async function initRepo(config: GlobalConfig, context: vscode.ExtensionContext, dest: vscode.Uri) {
  // Create output
  if (output === undefined) {
    output = vscode.window.createOutputChannel("Zephyr Tools");
  }
  output.show();

  try {
    // Tasks
    let taskName = "Zephyr Tools: Init Repo";

    // Pick options
    const pickOptions: vscode.QuickPickOptions = {
      ignoreFocusOut: true,
      placeHolder: "Where would you like to initialize from?",
    };

    // Get the root path of the workspace
    let rootPath = getRootPath();

    // Check if we're in the right workspace
    if (rootPath?.fsPath !== dest.fsPath) {
      console.log("Setting task!");

      // Set init-repo task next
      let task: ZephyrTask = { name: "zephyr-tools.init-repo", data: dest };
      context.globalState.update("zephyr.task", task);

      // Change workspace
      await vscode.commands.executeCommand("vscode.openFolder", dest);
    }

    // Set .vscode/settings.json
    // Temporarily of course..
    let settings = {
      "git.enabled": false,
      "git.path": null,
      "git.autofetch": false,
    };

    // Make .vscode dir and settings.json
    await fs.mkdirp(path.join(dest.fsPath, ".vscode"));
    await fs.writeFile(path.join(dest.fsPath, ".vscode", "settings.json"), JSON.stringify(settings));

    // Options for Shell execution options
    let shellOptions: vscode.ShellExecutionOptions = {
      env: <{ [key: string]: string }>config.env,
      cwd: dest.fsPath,
    };

    // Check if .git is already here.
    let exists = await fs.pathExists(path.join(dest.fsPath, ".west"));

    if (!exists) {
      // Options for input box
      const inputOptions: vscode.InputBoxOptions = {
        prompt: "Enter git repository URL.",
        placeHolder: "<Enter your git repository address here>",
        ignoreFocusOut: true,
        validateInput: text => {
          return text !== undefined && text !== "" ? null : "Enter a valid git repository address.";
        },
      };

      // Prompt for URL to init..
      let url = await vscode.window.showInputBox(inputOptions);
      if (url === undefined) {
        vscode.window.showErrorMessage(`Zephyr Tools: invalid repository url provided.`);
        return;
      }

      // Ask for branch
      const branchInputOptions: vscode.InputBoxOptions = {
        prompt: "Enter branch name.",
        placeHolder: "Press enter for default",
        ignoreFocusOut: true,
      };

      let branch = await vscode.window.showInputBox(branchInputOptions);

      // TODO: determine choices for west.yml
      let manifest = "west.yml";

      // git clone to destination
      let cmd = `west init -m ${url} --mf ${manifest}`;

      // Set branch option
      if (branch !== undefined && branch !== "") {
        console.log(`Branch '${branch}'`);

        cmd = cmd + ` --mr ${branch}`;
      }

      let exec = new vscode.ShellExecution(cmd, shellOptions);

      // Task
      let task = new vscode.Task(
        { type: "zephyr-tools", command: taskName },
        vscode.TaskScope.Workspace,
        taskName,
        "zephyr-tools",
        exec
      );

      // Start execution
      await TaskManager.push(task, { ignoreError: true, lastTask: false });
    }

    // `west update`
    let cmd = `west update`;
    let exec = new vscode.ShellExecution(cmd, shellOptions);

    // Task
    let task = new vscode.Task(
      { type: "zephyr-tools", command: taskName },
      vscode.TaskScope.Workspace,
      taskName,
      "zephyr-tools",
      exec
    );

    // Start execution
    await TaskManager.push(task, { ignoreError: false, lastTask: false });

    // Generic callback
    let done = async (data: any) => {
      // Set the isInit flag
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };
      project.isInit = true;
      await context.workspaceState.update("zephyr.project", project);
    };

    // Get zephyr BASE
    let base = "zephyr";

    {
      let exec = util.promisify(cp.exec);

      // Get listofports
      let cmd = `west list -f {path:28}`;
      let res = await exec(cmd, { env: config.env, cwd: dest.fsPath });
      if (res.stderr) {
        output.append(res.stderr);
        output.show();
      } else {
        res.stdout.split("\n").forEach((line: string) => {
          if (line.includes("zephyr")) {
            base = line.trim();
          }
        });
      }
    }

    // Install python dependencies `pip install -r zephyr/requirements.txt`
    cmd = `pip install -r ${path.join(base, "scripts", "requirements.txt")}`;
    exec = new vscode.ShellExecution(cmd, shellOptions);

    // Task
    task = new vscode.Task(
      { type: "zephyr-tools", command: taskName },
      vscode.TaskScope.Workspace,
      taskName,
      "zephyr-tools",
      exec
    );

    // Start execution
    await TaskManager.push(task, {
      ignoreError: false,
      lastTask: true,
      successMessage: "Init complete!",
      callback: done,
      callbackData: { dest: dest },
    });
  } catch (error) {
    let text = "";
    if (typeof error === "string") {
      text = error;
    } else if (error instanceof Error) {
      text = error.message;
    }

    output.append(text);
    vscode.window.showErrorMessage(`Zephyr Tools: Init Repo error. See output for details.`);
  }
}

async function getPort(): Promise<string | undefined> {
  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Get listofports
  let cmd = `zephyr-tools -l`;
  let res = await exec(cmd, { env: config.env });
  if (res.stderr) {
    output.append(res.stderr);
    output.show();
    return undefined;
  }

  // Get port
  let ports = JSON.parse(res.stdout);

  console.log(ports);

  // Have them choose from list of ports
  const port = await vscode.window.showQuickPick(ports, {
    title: "Pick your serial port.",
    placeHolder: ports[0],
    ignoreFocusOut: true,
  });

  if (port === undefined) {
    vscode.window.showErrorMessage("Invalid port choice.");
    return undefined;
  }

  return port;
}

async function getBaud(_baud: string): Promise<string | undefined> {
  // Then have them choose BAUD (default to 1000000 for newtmgr)
  const baud =
    (await vscode.window.showQuickPick(baudlist, {
      title: "Pick your baud rate.",
      placeHolder: _baud,
      ignoreFocusOut: true,
    })) ?? _baud;

  if (baud === "") {
    vscode.window.showErrorMessage("Invalid baud rate choice.");
    return undefined;
  }

  return baud;
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function load(config: GlobalConfig, project: ProjectConfig) {
  // Options for SehllExecution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
  };

  // Tasks
  let taskName = "Zephyr Tools: Load";

  // Check if update file exists
  let files = ["app_update.bin", "zephyr.signed.bin"];
  let index = 0;
  let found = false;

  for (var file of files) {
    // Check if app_update.bin exists. If not, warn them about building and that bootloader is enabled
    let exists = await fs.pathExists(path.join(project.target ?? "", "build", "zephyr", file));
    if (exists) {
      found = true;
      break;
    }

    index++;
  }

  // Don't proceed if nothing found..
  if (!found) {
    vscode.window.showWarningMessage("Binary not found. Build project before loading.");
    return;
  }

  // Put device into BL mode automagically
  if (project.board == "circuitdojo_feather_nrf9160_ns") {
    let cmd = `zephyr-tools -b`;
    let exec = new vscode.ShellExecution(cmd, options);

    // Task
    let task = new vscode.Task(
      { type: "zephyr-tools", command: taskName },
      vscode.TaskScope.Workspace,
      taskName,
      "zephyr-tools",
      exec
    );

    // Start execution
    await TaskManager.push(task, {
      ignoreError: false,
      lastTask: true,
      errorMessage: "Load error! Did you init your project?",
      successMessage: "Load complete!",
    });
  }

  // Upload image
  let cmd = `newtmgr -c vscode-zephyr-tools image upload ${path.join(
    project.target ?? "",
    "build",
    "zephyr",
    files[index]
  )} -r 3 -t 0.25`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec
  );

  // Start execution
  await TaskManager.push(task, {
    ignoreError: false,
    lastTask: true,
    errorMessage: "Load error! Did you init your project?",
    successMessage: "Load complete!",
  });

  // Delay
  delay(1000);

  // Command
  cmd = `newtmgr -c vscode-zephyr-tools reset`;
  exec = new vscode.ShellExecution(cmd, options);

  // Task
  task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec
  );

  // Start execution
  await TaskManager.push(task, {
    ignoreError: false,
    lastTask: true,
    errorMessage: "Reset error! Did you init your project?",
    successMessage: "Device reset!",
  });

  vscode.window.showInformationMessage(`Loading via bootloader for ${project.board}`);
}

async function monitor(config: GlobalConfig, project: ProjectConfig) {
  // Options for SehllExecution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Serial Monitor";
  let port = project.port;

  // Command to run
  let cmd = `zephyr-tools --port ${port} --follow --save`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec
  );

  // Start execution
  await TaskManager.push(task, {
    ignoreError: false,
    lastTask: true,
    errorMessage: "Serial monitor error!",
  });
}

// TODO: select programmer ID if there are multiple..
async function flash(config: GlobalConfig, project: ProjectConfig) {
  // Options for SehllExecution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Flash";

  // Generate universal build path that works on windows & *nix
  let buildPath = path.join("build", project.board?.split("/")[0] ?? "");
  let cmd = `west flash -d ${buildPath}`;

  // Add runner if it exists
  if (project.runner) {
    cmd += ` -r ${project.runner} ${project.runnerParams ?? ""}`;
  }

  console.log("command: " + cmd);

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName, isBackground: true },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec
  );

  vscode.window.showInformationMessage(`Flashing for ${project.board}`);

  // Start task here
  await vscode.tasks.executeTask(task);
}

function getRootPath(): vscode.Uri | undefined {
  // Get the workspace root
  let rootPath = undefined;
  if (vscode.workspace.workspaceFolders?.length ?? 0 > 0) {
    rootPath = vscode.workspace.workspaceFolders?.[0].uri;
  } else {
    rootPath = undefined;
  }

  return rootPath;
}

async function parseBoardYaml(file: string): Promise<string[]> {
  // Result
  let boards: string[] = [];

  let contents = await vscode.workspace.openTextDocument(file).then(document => {
    return document.getText();
  });

  let parsed = yaml.parse(contents);
  let parsed_boards = [];

  // if contents.boards exist then iterate
  if (parsed.boards !== undefined) {
    parsed_boards = parsed.boards;
  } else {
    parsed_boards.push(parsed.board);
  }

  for (let board of parsed_boards) {
    // Check if socs has one entry
    if (board.socs.length == 0) {
      continue;
    }

    let soc = board.socs[0];

    // Add board to list
    boards.push(`${board.name}/${soc.name}`);

    // Add all variants
    if (soc.variants !== undefined) {
      for (let variant of soc.variants) {
        boards.push(`${board.name}/${soc.name}/${variant.name}`);
      }
    }

    // iterate all revisions if revision exists
    if (board.revision !== undefined && board.revision.revisions !== undefined) {
      for (let revision of board.revision.revisions) {
        // Check if default and continue
        if (board.revision.default === revision.name) {
          continue;
        }

        // Add board to list
        boards.push(`${board.name}@${revision.name}/${soc.name}`);

        // Add all variants
        if (soc.variants !== undefined) {
          for (let variant of soc.variants) {
            boards.push(`${board.name}@${revision.name}/${soc.name}/${variant.name}`);
          }
        }
      }
    }
  }

  return boards;
}

async function getBoardList(folder: vscode.Uri): Promise<string[]> {
  const result: string[] = [];
  const foldersToIgnore = ["build", ".git", "bindings"];

  const folderQueue: string[] = [folder.fsPath];

  while (folderQueue.length > 0) {
    const currentFolder = folderQueue.shift() as string;

    // Check if board.yml exists in currentFolder
    let board_yaml_path = path.join(currentFolder, "board.yml");
    if (fs.existsSync(board_yaml_path)) {
      let boards = await parseBoardYaml(board_yaml_path);
      result.push(...boards);
      continue;
    }

    // If board.yml isn't found we'll have to do a deeper search
    const entries = fs.readdirSync(currentFolder, { withFileTypes: true });

    // Iterate over all entries
    for (const entry of entries) {
      if (entry.isDirectory() && !foldersToIgnore.includes(entry.name)) {
        folderQueue.push(path.join(currentFolder, entry.name));
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".yaml")) {
          const filePath = path.join(currentFolder, entry.name);

          // Remove .yaml from name
          let name = path.parse(filePath).name;

          // Add name to result
          result.push(name);
        }
      }
    }
  }

  return result;
}

async function getProjectList(folder: vscode.Uri): Promise<string[]> {
  let files = await vscode.workspace.fs.readDirectory(folder);
  let projects: string[] = [];

  while (true) {
    let file = files.pop();

    // Stop looping once done.
    if (file === undefined) {
      break;
    }

    if (file[0].includes("CMakeLists.txt")) {
      // Check the filefolder
      let filepath = vscode.Uri.joinPath(folder, file[0]);
      let contents = await vscode.workspace.openTextDocument(filepath).then(document => {
        return document.getText();
      });

      if (contents.includes("project(")) {
        let project = path.parse(filepath.fsPath);
        projects.push(project.dir);
      }
    } else if (file[0].includes("build") || file[0].includes(".git")) {
      // Don't do anything
    } else if (file[1] === vscode.FileType.Directory) {
      let path = vscode.Uri.joinPath(folder, file[0]);
      let subfolders = await vscode.workspace.fs.readDirectory(path);

      for (let { index, value } of subfolders.map((value, index) => ({
        index,
        value,
      }))) {
        subfolders[index][0] = vscode.Uri.parse(`${file[0]}/${subfolders[index][0]}`).fsPath;
        // console.log(subfolders[index][0]);
      }

      files = files.concat(subfolders);
    }
  }

  return projects;
}

async function changeProject(config: GlobalConfig, context: vscode.ExtensionContext) {
  // Fetch the project config
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {
    isInit: false,
  };

  // Create & clear output
  if (output === undefined) {
    output = vscode.window.createOutputChannel("Zephyr Tools");
  }

  // Get the workspace root
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Clear output before beginning
  output.clear();

  // Get manifest path `west config manifest.path`
  let cmd = "west config manifest.path";
  let res = await exec(cmd, { env: config.env, cwd: rootPath.fsPath });
  if (res.stderr) {
    output.append(res.stderr);
    output.show();
    return;
  }

  // Find all CMakeLists.txt files with `project(` in them
  let files = await getProjectList(vscode.Uri.joinPath(rootPath, res.stdout.trim()));
  console.log(files);

  // Turn that into a project selection
  const result = await vscode.window.showQuickPick(files, {
    placeHolder: "Pick your target project..",
    ignoreFocusOut: true,
  });

  if (result) {
    console.log("Changing project to " + result);
    vscode.window.showInformationMessage(`Project changed to ${result}`);
    project.target = result;
    await context.workspaceState.update("zephyr.project", project);
  }
}

async function changeBoard(config: GlobalConfig, context: vscode.ExtensionContext) {
  // TODO: iterative function to find all possible board options
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {
    isInit: false,
  };

  // Get the workspace root
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  let boards: string[] = [];

  let files = await vscode.workspace.fs.readDirectory(rootPath);
  for (const [index, [file, type]] of files.entries()) {
    if (type == vscode.FileType.Directory) {
      // Ignore folders that begin with .
      if (file.startsWith(".")) {
        continue;
      }

      // Get boards
      let boardsDir = vscode.Uri.joinPath(rootPath, `${file}/boards`);

      // Only check if path exists
      if (fs.pathExistsSync(boardsDir.fsPath)) {
        console.log("Searching boards dir: " + boardsDir.fsPath);
        boards = boards.concat(await getBoardList(boardsDir));
      }
    }
  }

  // Prompt which board to use
  const result = await vscode.window.showQuickPick(boards, {
    placeHolder: "Pick your board..",
    ignoreFocusOut: true,
  });

  if (result) {
    console.log("Changing board to " + result);
    vscode.window.showInformationMessage(`Board changed to ${result}`);
    project.board = result;
    await context.workspaceState.update("zephyr.project", project);
  }
}

async function changeSysBuild(config: GlobalConfig, context: vscode.ExtensionContext) {
  // TODO: iterative function to find all possible board options
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {
    isInit: false,
  };

  // Get the workspace root
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  // Yes to enable, no to disable popup
  const result = await vscode.window.showQuickPick(["Yes", "No"], {
    placeHolder: "Enable sysbuild?",
    ignoreFocusOut: true,
  });

  if (result) {
    if (result === "Yes") {
      project.sysbuild = true;
    } else {
      project.sysbuild = false;
    }
    await context.workspaceState.update("zephyr.project", project);
  }
}

async function changeRunner(config: GlobalConfig, context: vscode.ExtensionContext) {
  // TODO: iterative function to find all possible board options
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {
    isInit: false,
  };

  // Get the workspace root
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  let runners: string[] = ["default"];

  // Get runners from $rootPath/zephyr/scripts/west_commands/runners
  const runnersDir = path.join(rootPath.fsPath, "zephyr", "scripts", "west_commands", "runners");

  try {
    const files = fs.readdirSync(runnersDir);
    const r = files.filter(file => file.endsWith(".py") && file !== "__init__.py").map(file => file.replace(".py", ""));
    console.log(r);

    runners.push(...r);
    vscode.window.showInformationMessage(`Runners: ${runners.join(", ")}`);
  } catch (err) {
    if (err instanceof Error) {
      vscode.window.showErrorMessage(`Error reading runners directory: ${err.message}`);
    } else {
      vscode.window.showErrorMessage("An unknown error occurred while reading the runners directory.");
    }
  }

  let args = "";

  console.log("Runners: " + runners);

  // Prompt which board to use
  const result = await vscode.window.showQuickPick(runners, {
    placeHolder: "Pick your runner..",
    ignoreFocusOut: true,
  });

  let argsResult = await vscode.window.showInputBox({
    placeHolder: "Enter runner args..",
    ignoreFocusOut: true,
  });

  if (result) {
    // Check to make sure args are not undefined
    if (argsResult) {
      args = " with args: " + argsResult;

      // Set runner args
      project.runnerParams = argsResult;
    } else {
      project.runnerParams = undefined;
    }

    console.log("Changing runner to " + result + args);
    vscode.window.showInformationMessage(`Runner changed to ${result}${args}`);

    if (result === "default") {
      project.runner = undefined;
    } else {
      project.runner = result;
    }
    await context.workspaceState.update("zephyr.project", project);
  }
}

export async function update(config: GlobalConfig, project: ProjectConfig) {
  // Get the active workspace root path
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  // Options for Shell Execution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: rootPath.fsPath,
  };

  // Tasks
  let taskName = "Zephyr Tools: Update Dependencies";

  // Enable python env
  let cmd = `west update`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec
  );

  await vscode.tasks.executeTask(task);

  vscode.window.showInformationMessage(`Updating dependencies for project.`);
}

async function build(
  config: GlobalConfig,
  project: ProjectConfig,
  pristine: boolean,
  context: vscode.ExtensionContext
) {
  // Return if env is not set
  if (config.env === undefined) {
    console.log("Env is undefined!");
    return;
  }

  // Return if undefined
  if (project.board === undefined) {
    // Change board function
    await changeBoard(config, context);

    // Check again..
    if (project.board === undefined) {
      await vscode.window.showErrorMessage(`You must choose a board to continue.`);
      return;
    }
  }

  if (project.target === undefined) {
    await changeProject(config, context);

    // Check again..
    if (project.target === undefined) {
      await vscode.window.showErrorMessage(`You must choose a project to build.`);
      return;
    }
  }

  // Get the active workspace root path
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  // Options for SehllExecution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Build";

  // Generate universal build path that works on windows & *nix
  let buildPath = path.join("build", project.board?.split("/")[0] ?? "");

  // Enable python env
  let cmd = `west build -b ${project.board}${pristine ? " -p" : ""} -d ${buildPath}${
    project.sysbuild ? " --sysbuild" : ""
  }`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec
  );

  vscode.window.showInformationMessage(`Building for ${project.board}`);

  // Start execution
  await vscode.tasks.executeTask(task);
}

async function process_download(download: ManifestDownloadEntry, context: vscode.ExtensionContext) {
  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Check if it already exists
  let filepath = await FileDownload.exists(download.filename);

  // Download if doesn't exist _or_ hash doesn't match
  if (filepath === null || (await FileDownload.check(download.filename, download.md5)) === false) {
    output.appendLine("[SETUP] downloading " + download.url);
    filepath = await FileDownload.fetch(download.url);

    // Check again
    if ((await FileDownload.check(download.filename, download.md5)) === false) {
      vscode.window.showErrorMessage("Error downloading " + download.filename + ". Checksum mismatch.");
      return false;
    }
  }

  // Get the path to copy the contents to..
  let copytopath = path.join(toolsdir, download.name);

  // Add additional suffix if need be
  if (download.copy_to_subfolder) {
    copytopath = path.join(copytopath, download.copy_to_subfolder);
  }

  // Check if copytopath exists and create if not
  if (!(await fs.pathExists(copytopath))) {
    await fs.mkdirp(copytopath);
  }

  // Remove copy to path
  if (download.clear_target !== false) {
    await fs.remove(copytopath);
    await fs.mkdirp(copytopath);
  }

  // Unpack and place into `$HOME/.zephyrtools`
  if (download.url.includes(".zip")) {
    // Unzip and copy
    output.appendLine(`[SETUP] unzip ${filepath} to ${copytopath}`);
    const zip = new unzip.async({ file: filepath });
    zip.on("extract", (entry, file) => {
      // Make executable
      fs.chmodSync(file, 0o755);
    });
    await zip.extract(null, copytopath);
    await zip.close();
  } else if (download.url.includes("tar")) {
    // Then untar
    const cmd = `tar -xvf "${filepath}" -C "${copytopath}"`;
    output.appendLine(cmd);
    let res = await exec(cmd, { env: config.env }).then(
      value => {
        output.append(value.stdout);
        return true;
      },
      reason => {
        output.append(reason.stdout);
        output.append(reason.stderr);

        // Error message
        vscode.window.showErrorMessage("Error un-tar of download. Check output for more info.");

        return false;
      }
    );

    // Return if untar was unsuccessful
    if (!res) {
      return false;
    }
  } else if (download.url.includes("7z")) {
    // Unzip and copy
    output.appendLine(`[SETUP] 7z extract ${filepath} to ${copytopath}`);

    const pathTo7zip = sevenzip.path7za;
    const seven = node7zip.extractFull(filepath, copytopath, {
      $bin: pathTo7zip,
    });
  }

  // Set path
  let setpath = path.join(copytopath, download.suffix ?? "");
  config.env["PATH"] = path.join(setpath, pathdivider + config.env["PATH"]);

  // Then set the application environment to match
  if (config.env["PATH"] !== undefined && config.env["PATH"] !== "") {
    context.environmentVariableCollection.replace("PATH", config.env["PATH"]);
  }

  // Set remaining env variables
  for (let entry of download.env ?? []) {
    if (entry.value) {
      config.env[entry.name] = entry.value;
    } else if (entry.usepath && !entry.append) {
      config.env[entry.name] = path.join(copytopath, entry.suffix ?? "");
    } else if (entry.usepath && entry.append) {
      config.env[entry.name] = path.join(copytopath, (entry.suffix ?? "") + pathdivider + config.env[entry.name] ?? "");
    }

    console.log(`env[${entry.name}]: ${config.env[entry.name]}`);
  }

  // Save this informaiton to disk
  context.globalState.update("zephyr.env", config);

  // Run any commands that are needed..
  for (let entry of download.cmd ?? []) {
    output.appendLine(entry.cmd);

    // Prepend
    let cmd = entry.cmd;
    if (entry.usepath) {
      cmd = path.join(copytopath, entry.cmd ?? "");
    }

    // Run the command
    let res = await exec(cmd, { env: config.env }).then(
      value => {
        output.append(value.stdout);
        return true;
      },
      reason => {
        output.append(reason.stdout);
        output.append(reason.stderr);

        // Error message
        vscode.window.showErrorMessage("Error for sdk command.");

        return false;
      }
    );

    if (!res) {
      return false;
    }
  }

  return true;
}

async function clean(config: GlobalConfig, project: ProjectConfig) {
  // Get the active workspace root path
  let rootPath;
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    rootPath = rootPaths[0].uri;
  }

  // Return if undefined
  if (rootPath === undefined || project.board === undefined || project.target === undefined) {
    return;
  }

  //Get build folder
  let buildFolder = path.join(project.target.toString(), "build");

  // Remove build folder
  await fs.remove(buildFolder);

  vscode.window.showInformationMessage(`Cleaning ${project.target}`);
}

// this method is called when your extension is deactivated
export function deactivate() {}

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

// Default project configuration
const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  isInit: false,
  sysbuild: true,
};

// Output Channel
let output: vscode.OutputChannel;

// Configuratoin
let config: GlobalConfig;

// this method is called when your extension is activated
// Function to find a suitable Python 3.10+ version
async function findSuitablePython(output: vscode.OutputChannel): Promise<string | null> {
  const util = require("util");
  const cp = require("child_process");
  const exec = util.promisify(cp.exec);

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

  // Set up environment variable collection
  context.environmentVariableCollection.persistent = true;

  // If we have a previous setup, restore the PATH modifications
  if (config.isSetup && config.env["PATH"] !== undefined) {
    // Extract the added paths by comparing with current system PATH
    const systemPath = process.env["PATH"] || "";
    const configPath = config.env["PATH"];

    // If the config PATH is different from system PATH, extract the added paths
    if (configPath !== systemPath && configPath.length > systemPath.length) {
      // The config PATH should contain the system PATH at the end
      const pathDividerIndex = configPath.lastIndexOf(systemPath);
      if (pathDividerIndex > 0) {
        const addedPaths = configPath.substring(0, pathDividerIndex);
        // Remove trailing path divider if present
        const cleanAddedPaths = addedPaths.endsWith(pathdivider)
          ? addedPaths.substring(0, addedPaths.length - pathdivider.length)
          : addedPaths;

        // Split by path divider and add each path (in reverse order to maintain precedence)
        const individualPaths = cleanAddedPaths.split(pathdivider).filter(p => p.trim());
        for (const pathToAdd of individualPaths.reverse()) {
          context.environmentVariableCollection.prepend("PATH", pathToAdd + pathdivider);
        }
      }
    }
  }

  // Create new
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.create-project", async (dest: vscode.Uri | undefined) => {
      await commands.create_new(context, config, dest);
    }),
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
      // Clear any existing PATH modifications
      context.environmentVariableCollection.clear();

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

      // Pre-select toolchain before showing progress
      let selectedEntry: ManifestToolchainEntry | undefined;
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
          selectedEntry = element.toolchains.find(element => element.name === selection);

          // Check if it exists
          if (selectedEntry === undefined) {
            vscode.window.showErrorMessage("Unable to find toolchain entry.");
            return;
          }

          break;
        }
      }

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

          // Set up downloader path
          FileDownload.init(path.join(toolsdir, "downloads"));

          // For loop to process entry in manifest.json
          for (const [index, element] of platformManifest.entries()) {
            // Confirm it's the correct architecture
            if (element.arch === arch) {
              // Use the pre-selected toolchain
              let entry = selectedEntry;

              for (var download of element.downloads) {
                // Process download entry with enhanced error handling
                progress.report({ increment: 2, message: `Processing ${download.name}...` });
                let res = await process_download_with_validation(download, context);
                if (!res) {
                  output.appendLine(`[SETUP] ABORTING: Failed to process dependency ${download.name}`);
                  return;
                }
                progress.report({ increment: 3, message: `Completed ${download.name}` });
              }

              // Output indicating toolchain install
              output.appendLine(`[SETUP] Installing ${entry!.name} toolchain...`);

              for (var download of entry!.downloads) {
                // Process toolchain download entry with enhanced error handling
                progress.report({ increment: 2, message: `Processing toolchain ${download.name}...` });
                let res = await process_download_with_validation(download, context);
                if (!res) {
                  output.appendLine(`[SETUP] ABORTING: Failed to process toolchain ${download.name}`);
                  return;
                }
                progress.report({ increment: 3, message: `Completed ${download.name}` });
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
            },
          );

          // Return if error
          if (!res) {
            return;
          }

          progress.report({ increment: 5 });

          // Find a suitable Python 3.10+ version
          let suitablePython = await findSuitablePython(output);
          if (!suitablePython) {
            switch (platform) {
              case "linux":
                output.appendLine(
                  "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv` or newer",
                );
                break;
              case "win32":
                output.appendLine("[SETUP] install Python 3.10+ from python.org");
                break;
              case "darwin":
                output.appendLine("[SETUP] install Python 3.10+ using homebrew: `brew install python@3.10`");
                break;
            }
            vscode.window.showErrorMessage(
              "Python 3.10+ is required for Zephyr development. Check output for details.",
            );
            return;
          }

          // Use the suitable Python version
          python = suitablePython;
          output.appendLine(`[SETUP] Using Python: ${python}`);

          // Check Python install
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
                      "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`",
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
                    "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`",
                  );
                  break;
                default:
                  break;
              }
              return false;
            },
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
            },
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
            },
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
            },
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

          // Add Python paths to VS Code environment
          context.environmentVariableCollection.prepend("PATH", path.join(pythonenv, "Scripts") + pathdivider);
          context.environmentVariableCollection.prepend("PATH", path.join(pythonenv, "bin") + pathdivider);

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
            },
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

          // Environment is already set up via prepend operations above

          progress.report({ increment: 100 });

          vscode.window.showInformationMessage(`Zephyr Tools setup complete!`);
        },
      );
    }),
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
    }),
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
    }),
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
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup-monitor", async () => {
      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
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
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

      if (config.isSetup && project.isInit) {
        await build(config, project, true, context);
      } else if (!project.isInit) {
        vscode.window.showErrorMessage("Run `Zephyr Tools: Init Repo` command first.");
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command first.");
      }
    }),
  );

  // Utilizes build cache (if it exists) and builds
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.build", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Flashes Zephyr project to board
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Flashes Zephyr project to board using probe-rs
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash-probe-rs", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

      // Check if manifest is good
      if (config.manifestVersion !== manifest.version) {
        vscode.window.showErrorMessage("An update is required. Run `Zephyr Tools: Setup` command first.");
        return;
      }

      // Flash board
      if (config.isSetup) {
        await flashProbeRs(config, project);
      } else {
        // Display an error message box to the user
        vscode.window.showErrorMessage("Run `Zephyr Tools: Setup` command before flashing.");
      }
    }),
  );

  // Cleans the project by removing the `build` folder
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.clean", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Update dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.update", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // TODO: command for loading via `newtmgr/mcumgr`
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.load", async () => {
      // Cancel all pending tasks
      await TaskManager.cancel();

      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // TODO: command for loading via `newtmgr/mcumgr`
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.load-and-monitor", async () => {
      // Cancel all pending tasks
      await TaskManager.cancel();

      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Update dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.monitor", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Command for flashing and monitoring
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.flash-and-monitor", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Command for changing whether or not to use sysbuild
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-sysbuild", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Command for changing runner and params
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.change-runner", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
  );

  // Command for setting up `newtmgr/mcumgr`
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-tools.setup-newtmgr", async () => {
      // Fetch the project config
      let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    }),
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
        exec,
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
      exec,
    );

    // Callback to run after west update completes
    let westUpdateCallback = async (data: any) => {
      output.appendLine(`[INIT] West update completed, determining zephyr base path...`);

      // Get zephyr BASE
      let base = "zephyr";

      {
        let exec = util.promisify(cp.exec);

        // Get listofports
        let cmd = `west list -f {path:28}`;
        output.appendLine(`[INIT] Running: ${cmd}`);
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
        output.appendLine(`[INIT] Determined zephyr base path: ${base}`);
      }

      // Install python dependencies using virtual environment Python
      let pythonenv = path.join(toolsdir, "env");
      let venvPython =
        platform === "win32" ? path.join(pythonenv, "Scripts", "python.exe") : path.join(pythonenv, "bin", "python");
      let cmd = `"${venvPython}" -m pip install -r ${path.join(base, "scripts", "requirements.txt")}`;
      output.appendLine(`[INIT] Starting pip install: ${cmd}`);
      let exec = new vscode.ShellExecution(cmd, shellOptions);

      // Task
      let task = new vscode.Task(
        { type: "zephyr-tools", command: taskName },
        vscode.TaskScope.Workspace,
        taskName,
        "zephyr-tools",
        exec,
      );

      // Final callback after pip install completes
      let done = async (data: any) => {
        // Set the isInit flag
        let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;
        project.isInit = true;
        await context.workspaceState.update("zephyr.project", project);
      };

      // Start execution
      await TaskManager.push(task, {
        ignoreError: false,
        lastTask: true,
        successMessage: "Init complete!",
        callback: done,
        callbackData: { dest: dest },
      });
    };

    // Start execution - west update with callback to run pip install after completion
    output.appendLine(`[INIT] Starting west update...`);
    await TaskManager.push(task, {
      ignoreError: false,
      lastTask: false,
      callback: westUpdateCallback,
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

  // Get reduced device name
  let boardName = project.board?.split("/")[0] ?? "";
  console.log("boardName: " + boardName);

  // Track if we foudn a file
  let target = "";

  // Check if build/boardName/dfu_application.zip_manifest.json exists
  const manifest = path.join(project.target ?? "", "build", boardName, "dfu_application.zip_manifest.json");
  let exists = await fs.pathExists(manifest);

  if (exists) {
    // Make sure zip file exists
    const dfu_zip = path.join(project.target ?? "", "build", boardName, "dfu_application.zip");
    const dfu_zip_exists = await fs.pathExists(dfu_zip);

    // Doesn't exist error
    if (!dfu_zip_exists) {
      vscode.window.showWarningMessage(dfu_zip + " not found!");
      return;
    }

    // Unzip dfu_application.zip
    const zip = new unzip.async({ file: dfu_zip });
    await zip.extract(null, path.join(project.target ?? "", "build", boardName));
    await zip.close();

    // Read the contents of the JSON file
    const content = fs.readFileSync(manifest).toString();
    const parsed = JSON.parse(content);

    // Get entry
    if (parsed.name === undefined) {
      vscode.window.showWarningMessage("Invalid manifest format.");
      return;
    }

    // Try to find the binary file - newer SDK uses .signed.bin, older uses .bin
    let signedBinary = path.join(project.target ?? "", "build", boardName, parsed.name + ".signed.bin");
    let regularBinary = path.join(project.target ?? "", "build", boardName, parsed.name + ".bin");

    if (await fs.pathExists(signedBinary)) {
      target = signedBinary;
    } else if (await fs.pathExists(regularBinary)) {
      target = regularBinary;
    } else {
      vscode.window.showWarningMessage(`Binary not found. Expected ${parsed.name}.signed.bin or ${parsed.name}.bin`);
      return;
    }
  } else {
    // Check if update file exists
    let files = ["app_update.bin", "zephyr.signed.bin"];

    for (var file of files) {
      // Get target path
      let targetPath = path.join(project.target ?? "", "build", boardName, "zephyr", file);

      // Check if app_update.bin exists. If not, warn them about building and that bootloader is enabled
      let exists = await fs.pathExists(targetPath);
      if (exists) {
        target = targetPath;
        break;
      }
    }
  }

  // Don't proceed if nothing found..
  if (target === "") {
    vscode.window.showWarningMessage("Binary not found. Build project before loading.");
    return;
  }

  // Put device into BL mode automagically
  if (boardName.includes("circuitdojo_feather_nrf9160")) {
    let cmd = `zephyr-tools -b`;
    let exec = new vscode.ShellExecution(cmd, options);

    // Task
    let task = new vscode.Task(
      { type: "zephyr-tools", command: taskName },
      vscode.TaskScope.Workspace,
      taskName,
      "zephyr-tools",
      exec,
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
  let cmd = `newtmgr -c vscode-zephyr-tools image upload ${target} -r 3 -t 0.25`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
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
    exec,
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
    exec,
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
    exec,
  );

  vscode.window.showInformationMessage(`Flashing for ${project.board}`);

  // Start task here
  await vscode.tasks.executeTask(task);
}

// Flash using probe-rs
async function flashProbeRs(config: GlobalConfig, project: ProjectConfig) {
  // Options for ShellExecution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>config.env,
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Flash with probe-rs";

  // Generate universal build path that works on windows & *nix
  let buildPath = path.join("build", project.board?.split("/")[0] ?? "");
  let hexFilePathZephyr = path.join(buildPath, "zephyr", "merged.hex");
  let hexFilePathBoard = path.join(buildPath, "merged.hex");
  
  let hexFilePath = "";
  
  // Check if merged.hex exists in zephyr subdirectory first
  if (await fs.pathExists(path.join(project.target ?? "", hexFilePathZephyr))) {
    hexFilePath = hexFilePathZephyr;
  }
  // If not found, check in board directory
  else if (await fs.pathExists(path.join(project.target ?? "", hexFilePathBoard))) {
    hexFilePath = hexFilePathBoard;
  }
  // If not found in either location, show error
  else {
    vscode.window.showErrorMessage(`Hex file not found at paths: ${hexFilePathZephyr} or ${hexFilePathBoard}. Build project before flashing.`);
    return;
  }

  // Check for available probes first
  let probeId: string | undefined;
  const availableProbes = await getAvailableProbes(config);
  if (!availableProbes) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return;
  }
  
  if (availableProbes.length === 0) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return;
  } else if (availableProbes.length === 1) {
    // Single probe, use it automatically
    probeId = availableProbes[0].probeId;
    console.log(`Using single available probe: ${probeId}`);
  } else {
    // Multiple probes, let user choose
    const selectedProbe = await selectProbe(availableProbes);
    if (!selectedProbe) {
      vscode.window.showErrorMessage("No probe selected for probe-rs flashing.");
      return;
    }
    probeId = selectedProbe.probeId;
  }

  // Get chip name from user selection or use cached value
  let chipName: string | undefined;
  
  // Use runner field as chip name if specified, otherwise prompt user
  if (project.runner && project.runner !== "default") {
    chipName = project.runner;
  } else {
    // Get available chips from probe-rs
    chipName = await getProbeRsChipName(config);
    if (!chipName) {
      vscode.window.showErrorMessage("No chip selected for probe-rs flashing.");
      return;
    }
  }

  // Command - use probe-rs download with the merged.hex file
  let cmd = `probe-rs download --chip ${chipName} --binary-format hex ${hexFilePath}`;
  
  // Append --probe flag if probeId is available
  if (probeId) {
    cmd += ` --probe ${probeId}`;
  }

  console.log("probe-rs command: " + cmd);

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Flashing with probe-rs for ${project.board} using chip: ${chipName}`);

  // Start execution with error handling and callback for reset
  await TaskManager.push(task, {
    ignoreError: false,
    lastTask: false,
    errorMessage: "probe-rs flash error! Check that your probe is connected and the chip name is correct.",
    callback: async () => {
      // Reset the device after successful programming
      let resetCmd = `probe-rs reset --chip ${chipName}`;
      
      // Append --probe flag if probeId is available
      if (probeId) {
        resetCmd += ` --probe ${probeId}`;
      }
      
      console.log("probe-rs reset command: " + resetCmd);
      
      let resetExec = new vscode.ShellExecution(resetCmd, options);
      
      let resetTask = new vscode.Task(
        { type: "zephyr-tools", command: taskName },
        vscode.TaskScope.Workspace,
        taskName,
        "zephyr-tools",
        resetExec,
      );
      
      // Execute reset as final task
      await TaskManager.push(resetTask, {
        ignoreError: false,
        lastTask: true,
        errorMessage: "probe-rs reset error! Device may not have been reset properly.",
        successMessage: "Flash and reset complete!",
      });
    }
  });
}

// Get probe-rs chip name from user selection
async function getProbeRsChipName(config: GlobalConfig): Promise<string | undefined> {
  try {
    // Promisified exec
    let exec = util.promisify(cp.exec);
    
    // Get chip list from probe-rs
    let cmd = `probe-rs chip list`;
    let res = await exec(cmd, { env: config.env });
    
    if (res.stderr) {
      vscode.window.showErrorMessage(`Error getting probe-rs chip list: ${res.stderr}`);
      return undefined;
    }

    // Parse the output to extract chip names
    let chipNames = parseProbeRsChipList(res.stdout);
    
    if (chipNames.length === 0) {
      vscode.window.showErrorMessage("No chips found in probe-rs chip list.");
      return undefined;
    }

    // Show chip selection to user
    const selectedChip = await vscode.window.showQuickPick(chipNames, {
      title: "Select probe-rs target chip",
      placeHolder: "Choose the target chip for flashing...",
      ignoreFocusOut: true,
    });

    return selectedChip;
  } catch (error) {
    vscode.window.showErrorMessage(`Error running probe-rs chip list: ${error}`);
    return undefined;
  }
}

// Parse probe-rs chip list output to extract available chip variants
function parseProbeRsChipList(output: string): string[] {
  const lines = output.split('\n');
  const chipNames: string[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Look for variant lines (they are indented and don't end with "Series")
    if (trimmedLine && 
        !trimmedLine.endsWith('Series') && 
        !trimmedLine.startsWith('Variants:') &&
        trimmedLine !== 'Variants:' &&
        line.startsWith('        ')) { // Variants are indented with 8 spaces
      chipNames.push(trimmedLine);
    }
  }
  
  // Sort alphabetically for easier selection
  return chipNames.sort();
}

// Interface for probe information
interface ProbeInfo {
  id: string;
  name: string;
  probeId?: string; // The actual probe identifier for --probe flag
}

// Get available probes from probe-rs list command
async function getAvailableProbes(config: GlobalConfig): Promise<ProbeInfo[] | null> {
  try {
    // Promisified exec
    let exec = util.promisify(cp.exec);
    
    // Get probe list from probe-rs
    let cmd = `probe-rs list`;
    let res = await exec(cmd, { env: config.env });
    
    if (res.stderr && res.stderr.trim() !== "") {
      console.error(`probe-rs list stderr: ${res.stderr}`);
      // Don't return null for stderr - probe-rs might still output valid probes
    }

    // Parse the output to extract probe information
    let probes = parseProbeRsList(res.stdout);
    
    return probes;
  } catch (error) {
    console.error(`Error running probe-rs list: ${error}`);
    return null;
  }
}

// Parse probe-rs list output to extract available probes
function parseProbeRsList(output: string): ProbeInfo[] {
  const lines = output.split('\n');
  const probes: ProbeInfo[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Look for probe entries - they typically have format like:
    // "[0]: J-Link (J-Link) (VID: 1366, PID: 0101, Serial: 000123456789, JLink)"
    // "[0]: Debug Probe (CMSIS-DAP) -- 2e8a:000c:E663383087545423 (CMSIS-DAP)"
    // or similar patterns from different probe types
    if (trimmedLine && (trimmedLine.includes('VID:') || trimmedLine.includes('Serial:') || 
        (trimmedLine.startsWith('[') && trimmedLine.includes(']:')))) {
      // Extract probe ID from the bracket notation
      const idMatch = trimmedLine.match(/\[([^\]]+)\]/);
      if (idMatch) {
        const id = idMatch[1];
        
        // Extract everything after the ID and colon as the probe description
        const descriptionMatch = trimmedLine.match(/\[([^\]]+)\]:\s*(.+)/);
        if (descriptionMatch) {
          const fullDescription = descriptionMatch[2];
          
          // For the name, try to extract just the probe name part (before any additional info)
          // but keep the full description for display
          const nameMatch = fullDescription.match(/^([^(]+)/);
          const probeName = nameMatch ? nameMatch[1].trim() : fullDescription;
          
          // Extract probe identifier for --probe flag
          let probeIdentifier: string | undefined;
          
          // For CMSIS-DAP probes: extract VID:PID:Serial format
          // "Debug Probe (CMSIS-DAP) -- 2e8a:000c:E663383087545423 (CMSIS-DAP)"
          const cmsisMatch = fullDescription.match(/--\s*([0-9a-fA-F:]+)/);
          if (cmsisMatch) {
            probeIdentifier = cmsisMatch[1];
          }
          // For J-Link probes: extract serial number
          // "J-Link (J-Link) (VID: 1366, PID: 0101, Serial: 000123456789, JLink)"
          else {
            const serialMatch = fullDescription.match(/Serial:\s*([^,\s)]+)/);
            if (serialMatch) {
              probeIdentifier = serialMatch[1];
            }
          }
          
          probes.push({ 
            id, 
            name: `${probeName} - ${fullDescription}`,
            probeId: probeIdentifier
          });
        } else {
          // Fallback if regex doesn't match
          probes.push({ id, name: `Probe ${id}` });
        }
      } else {
        // Fallback: use the line index as ID if parsing fails
        const parts = trimmedLine.split(':');
        if (parts.length >= 2) {
          const id = parts[0].replace(/[\[\]]/g, '').trim();
          const name = parts.slice(1).join(':').trim();
          probes.push({ id, name: `${name} (${id})` });
        }
      }
    }
  }
  
  return probes;
}

// Show probe selection picker to user
async function selectProbe(probes: ProbeInfo[]): Promise<ProbeInfo | undefined> {
  const probeItems = probes.map(probe => ({
    label: probe.name,
    description: `ID: ${probe.id}`,
    probe: probe
  }));

  const selectedItem = await vscode.window.showQuickPick(probeItems, {
    title: "Select debug probe for flashing",
    placeHolder: "Choose which probe to use for flashing...",
    ignoreFocusOut: true,
  });

  return selectedItem?.probe;
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
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
  let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    exec,
  );

  await vscode.tasks.executeTask(task);

  vscode.window.showInformationMessage(`Updating dependencies for project.`);
}

async function build(
  config: GlobalConfig,
  project: ProjectConfig,
  pristine: boolean,
  context: vscode.ExtensionContext,
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

    // Reload project config after changeProject
    project = context.workspaceState.get("zephyr.project") ?? DEFAULT_PROJECT_CONFIG;

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
    exec,
  );

  vscode.window.showInformationMessage(`Building for ${project.board}`);

  // Start execution
  await vscode.tasks.executeTask(task);
}

async function validateExtraction(copytopath: string, extractionType: string): Promise<boolean> {
  try {
    if (!(await fs.pathExists(copytopath))) {
      output.appendLine(`[SETUP] ${extractionType} extraction validation failed: ${copytopath} does not exist`);
      return false;
    }

    const extractedFiles = await fs.readdir(copytopath);
    if (extractedFiles.length === 0) {
      output.appendLine(`[SETUP] ${extractionType} extraction validation failed: No files extracted to ${copytopath}`);
      return false;
    }

    output.appendLine(`[SETUP] ${extractionType} extraction validated: ${extractedFiles.length} items extracted`);
    return true;
  } catch (error) {
    output.appendLine(`[SETUP] ${extractionType} extraction validation error: ${error}`);
    return false;
  }
}

async function process_download_with_validation(
  download: ManifestDownloadEntry,
  context: vscode.ExtensionContext,
): Promise<boolean> {
  output.appendLine(`[SETUP] Starting processing: ${download.name}`);
  output.appendLine(`[SETUP] URL: ${download.url}`);
  output.appendLine(`[SETUP] Expected MD5: ${download.md5}`);

  const result = await process_download(download, context);

  if (result) {
    output.appendLine(`[SETUP] Successfully completed: ${download.name}`);
  } else {
    output.appendLine(`[SETUP] FAILED to process: ${download.name}`);
  }

  return result;
}

async function process_download(download: ManifestDownloadEntry, context: vscode.ExtensionContext) {
  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Check if it already exists
  let filepath: string | null = await FileDownload.exists(download.filename);

  // Download if doesn't exist _or_ hash doesn't match
  if (filepath === null || (await FileDownload.check(download.filename, download.md5)) === false) {
    output.appendLine("[SETUP] downloading " + download.url);

    // Download file
    try {
      filepath = await FileDownload.fetch(download.url);
    } catch (error) {
      output.appendLine(`[SETUP] Failed to download ${download.filename}: ${error}`);
      vscode.window.showErrorMessage(`Error downloading ${download.filename}. Check output for more info.`);
      return false;
    }

    // Check again
    if ((await FileDownload.check(download.filename, download.md5)) === false) {
      vscode.window.showErrorMessage("Error downloading " + download.filename + ". Checksum mismatch.");
      return false;
    }
  }

  // Ensure filepath is not null before proceeding
  if (filepath === null) {
    output.appendLine(`[SETUP] Critical error: filepath is null for ${download.filename}`);
    vscode.window.showErrorMessage(`Critical error: Unable to locate downloaded file ${download.filename}.`);
    return false;
  }

  // Get the path to copy the contents to..
  let copytopath = path.join(toolsdir, download.name);
  output.appendLine(`[SETUP] Initial copytopath: ${copytopath}`);

  // Add additional suffix if need be
  if (download.copy_to_subfolder) {
    copytopath = path.join(copytopath, download.copy_to_subfolder);
    output.appendLine(`[SETUP] Updated copytopath with subfolder: ${copytopath}`);
  }

  // Check if copytopath exists and create if not
  if (!(await fs.pathExists(copytopath))) {
    await fs.mkdirp(copytopath);
    output.appendLine(`[SETUP] Created target directory: ${copytopath}`);
  }

  // Remove copy to path
  if (download.clear_target !== false) {
    try {
      await fs.remove(copytopath);
      await fs.mkdirp(copytopath);
      output.appendLine(`[SETUP] Cleared and recreated target directory: ${copytopath}`);
    } catch (error) {
      output.appendLine(`[SETUP] Failed to prepare target directory: ${error}`);
      vscode.window.showErrorMessage(
        `Failed to prepare extraction directory for ${download.name}. Check output for details.`,
      );
      return false;
    }
  } else {
    output.appendLine(`[SETUP] Preserving existing target directory: ${copytopath}`);
  }

  // Unpack and place into `$HOME/.zephyrtools`
  if (download.url.includes(".zip")) {
    // Unzip and copy
    output.appendLine(`[SETUP] unzip ${filepath} to ${copytopath}`);
    try {
      const zip = new unzip.async({ file: filepath! });
      zip.on("extract", (entry, file) => {
        // Make executable
        if (platform !== "win32") {
          fs.chmodSync(file, 0o755);
        }
      });
      await zip.extract(null, copytopath);
      await zip.close();

      // Validate extraction
      if (!(await validateExtraction(copytopath, "ZIP"))) {
        vscode.window.showErrorMessage(`ZIP extraction failed for ${download.name}. Setup cannot continue.`);
        return false;
      }
    } catch (error) {
      output.appendLine(`[SETUP] ZIP extraction error: ${error}`);
      vscode.window.showErrorMessage(`Error extracting ZIP archive for ${download.name}. Setup cannot continue.`);
      return false;
    }
  } else if (download.url.includes("tar")) {
    // Then untar
    const cmd = `tar -xvf "${filepath!}" -C "${copytopath}"`;
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
      },
    );

    // Return if untar was unsuccessful
    if (!res) {
      return false;
    }

    // Validate tar extraction
    if (!(await validateExtraction(copytopath, "TAR"))) {
      vscode.window.showErrorMessage(`TAR extraction failed for ${download.name}. Setup cannot continue.`);
      return false;
    }
  } else if (download.url.includes("7z")) {
    // Unzip and copy
    output.appendLine(`[SETUP] Starting 7z extraction: ${filepath!} to ${copytopath}`);

    try {
      // Use 7zip-bin API to get the correct binary path
      const pathTo7zip = sevenzip.path7za;
      output.appendLine(`[SETUP] Using 7z binary from 7zip-bin: ${pathTo7zip}`);
      output.appendLine(`[SETUP] 7z source: ${filepath!}`);
      output.appendLine(`[SETUP] 7z destination: ${copytopath}`);

      // Use node-7z for extraction with proper API
      const seven = node7zip.extractFull(filepath!, copytopath, {
        $bin: pathTo7zip,
        $progress: true,
      });

      // Create promise to handle extraction
      await new Promise<void>((resolve, reject) => {
        seven.on("end", () => {
          output.appendLine(`[SETUP] 7z extraction completed successfully`);
          resolve();
        });

        seven.on("error", err => {
          output.appendLine(`[SETUP] 7z extraction error: ${err}`);
          reject(err);
        });
      });

      // Validate extraction was successful
      if (!(await validateExtraction(copytopath, "7z"))) {
        vscode.window.showErrorMessage(`7z extraction failed for ${download.name}. Setup cannot continue.`);
        return false;
      }
    } catch (error) {
      output.appendLine(`[SETUP] CRITICAL: 7z extraction error for ${download.name}: ${error}`);
      vscode.window.showErrorMessage(
        `Critical error extracting ${download.name}. Setup cannot continue. Check output for details.`,
      );
      return false;
    }
  }

  // Set path
  let setpath = path.join(copytopath, download.suffix ?? "");
  config.env["PATH"] = path.join(setpath, pathdivider + config.env["PATH"]);

  // Add toolchain path to VS Code environment without replacing system PATH
  context.environmentVariableCollection.prepend("PATH", setpath + pathdivider);

  // Set remaining env variables
  for (let entry of download.env ?? []) {
    if (entry.value) {
      config.env[entry.name] = entry.value;
    } else if (entry.usepath && !entry.append) {
      config.env[entry.name] = path.join(copytopath, entry.suffix ?? "");
    } else if (entry.usepath && entry.append) {
      config.env[entry.name] = path.join(
        copytopath,
        (entry.suffix ?? "") + pathdivider + (config.env[entry.name] ?? ""),
      );
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
      },
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

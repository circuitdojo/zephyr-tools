// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as os from 'os';
import * as downloader from "@microsoft/vscode-file-downloader-api";
import * as fs from 'fs-extra';
import * as path from 'path';
import { TaskManager } from './taskmanager';

type ManifestEnvEntry = {
	name: string,
	value?: string,
	usepath: boolean,
	append: boolean,
	suffix?: string,
};

type ManifestDownloadEntry = {
	name: string;
	url: string;
	md5: string;
	suffix?: string;
	env?: ManifestEnvEntry[],
	filename: string;
};

type ManifestEntry = {
	arch: string;
	downloads: ManifestDownloadEntry[];
};

type Manifest = {
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

// Important directories
let toolsdir = path.join(os.homedir(), toolsfoldername);

// Project specific configuration
interface ProjectConfig {
	board?: string;
	target?: string;
	comport?: string;
	isInit: boolean;
}

// Config for the exention
interface GlobalConfig {
	isSetup: boolean,
	env: { [name: string]: string | undefined };
}

// Pending Task
interface ZephyrTask {
	name?: string,
	data?: any,
};

// Output Channel
let output: vscode.OutputChannel;

// Configuratoin
let config: GlobalConfig;

// Original Environment
let envOriginal = process.env;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Init task manager
	TaskManager.init();

	// Get the configuration
	config = context.globalState.get("zephyr.env") ?? { env: process.env, isSetup: false };

	// Then set the application environment to match
	if (config.env["PATH"] !== undefined && config.env["PATH"] !== "") {
		context.environmentVariableCollection.replace("PATH", config.env["PATH"]);
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.setup', async () => {

		// Reset "zephyr.env"
		context.globalState.update("zephyr.task", undefined);
		context.globalState.update("zephyr.env", undefined);
		config.env = envOriginal;
		config.isSetup = false;

		// Show setup progress..
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Setting up Zephyr dependencies",
			cancellable: false
		}, async (progress, token) => {

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

			// Download dependenices first!
			const fileDownloader: downloader.FileDownloader = await downloader.getApi();

			for (const [key, value] of Object.entries(manifest)) {
				if (platform === key) {
					// For loop to process entry in manifest.json
					inner: for (const [index, element] of value.entries()) {
						// Confirm it's the correct architecture 
						if (element.arch === arch) {
							for (var download of element.downloads) {

								// TODO: EXTRA CREDIT -- check if already exists & hash 

								// Check if we can unzip..
								const shouldUnzip = download.url.includes(".zip");

								// Check if it already exists
								let filepath = await fileDownloader.getItem(download.filename, context).then((value) => value, (reason) => null);

								// Download if doesn't exist
								if (filepath === null) {
									output.appendLine("[SETUP] downloading " + download.url);


									filepath = await fileDownloader.downloadFile(
										vscode.Uri.parse(download.url),
										download.filename,
										context,
										undefined,
										undefined,
										{ shouldUnzip: shouldUnzip }
									);
								}

								// TODO: EXTRA CREDIT - check MD5

								// Get the path to copy the contents to..
								const copytopath = path.join(toolsdir, download.name);

								// Unpack and place into `$HOME/.zephyrtools`
								if (!download.url.includes("tar")) {
									await fs.copy(filepath.fsPath, copytopath, { overwrite: true });
								} else if (download.url.includes("tar")) {

									// Create copy to folder
									if (!await fs.pathExists(copytopath)) {
										await fs.mkdirp(copytopath);
									}

									// Then untar
									const cmd = `tar -xvf "${filepath.path}" -C "${copytopath}"`;
									output.appendLine(cmd);
									let res = await exec(cmd, { env: config.env }).then(value => {
										output.append(value.stdout);
										return true;
									}, (reason) => {
										output.append(reason.stdout);
										output.append(reason.stderr);

										// Error message
										vscode.window.showErrorMessage('Error un-tar of download. Check output for more info.');

										return false;
									});

									// Return if untar was unsuccessful
									if (!res) {
										return;
									}

								}

								// Set path
								let setpath = path.join(copytopath, download.suffix ?? "");
								config.env["PATH"] = path.join(setpath, pathdivider + config.env["PATH"]);

								// Set remainin env variables
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

								progress.report({ increment: 5 });

							};

							break inner;
						} else {

							// Check if we're at the end of arch check
							if (index === (value.length - 1)) {
								vscode.window.showErrorMessage('Unsupported architecture for Zephyr Tools!');
								return;
							}
						}
					}

					progress.report({ increment: 5 });

					// Break from loop since we found the correct platform
					break;

				} else {

					// Check if this is the last iteration 
					let platforms = Object.keys(manifest);
					let last = platforms[platforms.length - 1];

					if (last === key) {
						vscode.window.showErrorMessage('Unsupported platform for Zephyr Tools!');
						return;
					}
				}
			}

			// Check if Git exists in path
			let res: boolean = await exec("git --version", { env: config.env }).then(value => {
				output.append(value.stdout);
				output.append(value.stderr);
				output.appendLine("[SETUP] git installed");
				return true;
			}, (reason) => {
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
				vscode.window.showErrorMessage('Unable to continue. Git not installed. Check output for more info.');
				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			progress.report({ increment: 5 });

			// Otherwise, check Python install
			let cmd = `${python} --version`;
			output.appendLine(cmd);
			res = await exec(cmd, { env: config.env }).then(value => {

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
							output.appendLine("[SETUP] refer to your distros preferred `python3` install method.");
							break;
						default:
							break;
					}

					vscode.window.showErrorMessage('Error finding python. Check output for more info.');
					return false;
				}

				return true;
			}, (reason) => {
				output.append(reason.stderr);
				console.error(reason);

				// Error message
				vscode.window.showErrorMessage('Error getting python. Check output for more info.');
				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			progress.report({ increment: 5 });

			// Note: linux does not have ensurepip
			if (platform !== "linux") {
				// install pip (if not already)
				cmd = `${python} -m ensurepip`;
				output.appendLine(cmd);
				res = await exec(cmd, { env: config.env }).then(value => {
					output.append(value.stdout);
					output.appendLine("[SETUP] pip installed");

					return true;
				}, (reason) => {
					output.appendLine("[SETUP] unable to install pip");
					output.append(reason.stdout);
					output.append(reason.stderr);

					// Error message
					vscode.window.showErrorMessage('Error installing pip. Check output for more info.');

					return false;
				});

				// Return if error
				if (!res) {
					return;
				}
			}
			progress.report({ increment: 5 });

			// install virtualenv
			cmd = `${python} -m pip install virtualenv`;
			output.appendLine(cmd);
			await exec(cmd, { env: config.env }).then(value => {
				output.append(value.stdout);
				output.appendLine("[SETUP] virtualenv installed");
				return true;
			}, (reason) => {
				console.log(JSON.stringify(reason));
			});

			progress.report({ increment: 5 });

			// create virtualenv within `$HOME/.zephyrtools`
			let pythonenv = path.join(toolsdir, "env");

			cmd = `${python} -m virtualenv "${pythonenv}"`;
			output.appendLine(cmd);
			res = await exec(cmd, { env: config.env }).then(value => {
				output.append(value.stdout);
				output.appendLine("[SETUP] virtual python environment created");
				return true;
			}, (reason) => {
				output.appendLine("[SETUP] unable to setup virtualenv");

				// Error message
				vscode.window.showErrorMessage('Error installing virtualenv. Check output for more info.');
				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			// Report progress
			progress.report({ increment: 5 });

			// Add env/bin to path
			config.env["PATH"] = path.join(pythonenv, `Scripts${pathdivider}` + config.env["PATH"]);
			config.env["PATH"] = path.join(pythonenv, `bin${pathdivider}` + config.env["PATH"]);

			// Install `west`
			res = await exec(`${python} -m pip install west`, { env: config.env }).then(value => {
				output.append(value.stdout);
				output.append(value.stderr);
				output.appendLine("[SETUP] west installed");
				return true;
			}, (reason) => {
				output.appendLine("[SETUP] unable to install west");
				output.append(reason);

				// Error message
				vscode.window.showErrorMessage('Error installing west. Check output for more info.');
				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			output.appendLine("[SETUP] Zephyr setup complete!");

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
		});

	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.init-repo', async (_dest: vscode.Uri | undefined) => {

		let dest = _dest;

		// Check if undefined
		if (dest === undefined) {
			// Options for picker
			const dialogOptions: vscode.OpenDialogOptions = {
				canSelectFiles: false,
				canSelectFolders: true,
				title: "Select destination folder."
			};

			// Open file picker for destination directory
			let open = await vscode.window.showOpenDialog(dialogOptions);
			if (open === undefined) {
				vscode.window.showErrorMessage('Provide a target folder to initialize your repo.');
				return;
			}

			// Get fsPath
			open[0].fsPath;

			// Copy it over
			dest = open[0];
		}

		// See if config is set first
		if (config.isSetup) {
			initRepo(config, context, dest);
		} else {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Setup` command first.');
			return;
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.change-project', async () => {

		// See if config is set first
		if (config.isSetup) {
			changeProject(config, context);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command first.');
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.change-board', async () => {
		// See if config is set first
		if (config.isSetup) {
			changeBoard(config, context);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command first.');
		}

	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.select-com-port', async () => {
		// TODO: scan for available ports
		// TODO: show list and selection dialogue 
		// TODO: save to configuration
		console.log("TODO");
	}));

	// Does a pristine zephyr build
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.build-pristine', async () => {

		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

		if (config.isSetup && project.isInit) {
			await build(config, project, true, context);
		} else if (!project.isInit) {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Init Repo` command first.');
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Tools: Setup` command first.');
		}


	}));

	// Utilizes build cache (if it exists) and builds
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.build', async () => {

		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

		// Do some work
		if (config.isSetup && project.isInit) {
			await build(config, project, false, context);
		} else if (!project.isInit) {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Init Repo` command first.');
		} else {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Setup` command first.');
		}


	}));

	// Flashes Zephyr project to board
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.flash', async () => {
		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

		// Flash board
		if (config.isSetup) {
			await flash(config, project);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));


	// Cleans the project by removing the `build` folder
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.clean', async () => {
		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

		// Flash board
		if (config.isSetup) {
			await clean(config, project);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));

	// Update dependencies
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.update', async () => {

		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

		// Flash board
		if (config.isSetup) {
			await update(config, project);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}

	}));

	// TODO: command for loading via `newtmgr/mcumgr`
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.load', async () => {
		console.log("TODO");
	}));

	// Check if there's a task to run
	let task: ZephyrTask | undefined = context.globalState.get("zephyr.task");
	if (task !== undefined && task.name !== undefined) {

		console.log("Run task! " + JSON.stringify(task));

		context.globalState.update("zephyr.task", undefined);
		await vscode.commands.executeCommand(task.name, task.data);
	}

}

async function initRepo(config: GlobalConfig, context: vscode.ExtensionContext, dest: vscode.Uri) {
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
			placeHolder: 'Where would you like to initialize from?'
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
			await vscode.commands.executeCommand('vscode.openFolder', dest);

		}

		// Options for Shell execution options
		let shellOptions: vscode.ShellExecutionOptions = {
			env: <{ [key: string]: string; }>config.env,
			cwd: dest.fsPath
		};

		// TODO: determine App destinationa
		let appDest = path.join(dest.fsPath, "app");

		// Check if .git is already here.
		let exists = await fs.pathExists(path.join(appDest, ".git"));

		if (!exists) {

			// Options for input box
			const inputOptions: vscode.InputBoxOptions = {
				prompt: "Enter git repository URL.",
				placeHolder: "<Enter your git repository address here>",
				ignoreFocusOut: true,
				validateInput: (text) => {
					return (text !== undefined && text !== "") ? null : 'Enter a valid git repository address.';
				}
			};

			// Prompt for URL to init..
			let url = await vscode.window.showInputBox(inputOptions);
			if (url === undefined) {
				vscode.window.showErrorMessage(`Zephyr Tools: invalid repository url provided.`);
				return;
			}

			// git clone to destination
			let cmd = `git clone ${url} "${appDest}"`;
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

			// TODO: pick branch?

		}

		// Init repository with `west init -l`
		let cmd = `west init -l "${appDest}"`;
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

		// `west update`
		cmd = `west update`;
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
		await TaskManager.push(task, { ignoreError: false, lastTask: false });

		// Generic callback
		let done = async (data: any) => {

			// Set the isInit flag
			let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };
			project.isInit = true;
			await context.workspaceState.update("zephyr.project", project);

		};

		// Install python dependencies `pip install -r zephyr/requirements.txt`
		cmd = "pip install -r zephyr/scripts/requirements.txt";
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
			ignoreError: false, lastTask: true, successMessage: "Init complete!",
			callback: done, callbackData: { dest: dest }
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

// TODO: select programmer ID if there are multiple..
async function flash(config: GlobalConfig, project: ProjectConfig) {

	// Create output
	if (output === undefined) {
		output = vscode.window.createOutputChannel("Zephyr Tools");
	}

	// Clear output
	output.clear();

	// Get the active workspace root path
	let rootPath = "";

	// Return if rootPath undefined
	if (rootPath === undefined) {
		return;
	}

	// Dest path
	// let destPath = `${paths[platform]}/nrf/applications/user/${workspaceName}`;
	let destPath = "";

	// Create command based on current OS
	let cmd = "";
	cmd = "west flash";

	// Process slightly differently due to how windows is setup
	if (platform === "win32") {
		// cmd = `${paths["win"]}\\toolchain\\git-bash.exe -c "cd ${rootPath} && ${cmd}"`
	}

	// Show output as things begin.
	output.show();

	// Promisified exec
	let exec = util.promisify(cp.exec);

	// TOOO: handle real-time stream during build
	// Show we're building..
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Flashing board",
		cancellable: false
	}, async (progress, token) => {

		token.onCancellationRequested(() => {
			console.log("User canceled the long running operation");
		});

		// Execute the task
		await exec(cmd, { cwd: destPath, env: config.env }).then((value) => {
			output.append(value.stdout);
			output.append(value.stderr);
		}, (reason) => {
			output.append(reason.stdout);
			console.info(reason.stdout);
			output.append(reason.stderr);
			console.error(reason.stderr);
			// Error message 
			vscode.window.showErrorMessage('Error flashing. Check output for more info.');
		});

		progress.report({ increment: 100 });
		output.dispose();
	});

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

async function getBoardlist(folder: vscode.Uri): Promise<string[]> {


	let files = await vscode.workspace.fs.readDirectory(folder);
	let boards: string[] = [];

	while (true) {

		let file = files.pop();

		// Stop looping once done.
		if (file === undefined) {
			break;
		}

		if (file[0].includes(".yaml")) {

			let parsed = path.parse(file[0]);
			boards.push(parsed.name);

		}
		else if (file[0].includes("build") || file[0].includes(".git")) {
			// Don't do anything
		}
		else if (file[1] === vscode.FileType.Directory) {
			let path = vscode.Uri.joinPath(folder, file[0]);
			let subfolders = await vscode.workspace.fs.readDirectory(path);

			for (let { index, value } of subfolders.map((value, index) => ({ index, value }))) {
				subfolders[index][0] = vscode.Uri.parse(`${file[0]}/${subfolders[index][0]}`).fsPath;
				// console.log(subfolders[index][0]);
			}

			files = files.concat(subfolders);
		}
	}

	return boards;
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
			let contents = await vscode.workspace.openTextDocument(filepath).then((document) => {
				return document.getText();
			});

			if (contents.includes("project(")) {
				let project = path.parse(filepath.fsPath);
				projects.push(project.dir);
			}
		}
		else if (file[0].includes("build") || file[0].includes(".git")) {
			// Don't do anything
		}
		else if (file[1] === vscode.FileType.Directory) {
			let path = vscode.Uri.joinPath(folder, file[0]);
			let subfolders = await vscode.workspace.fs.readDirectory(path);

			for (let { index, value } of subfolders.map((value, index) => ({ index, value }))) {
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
	let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

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
		placeHolder: 'Pick your target project..'
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
	let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? { isInit: false };

	// Get the workspace root
	let rootPath;
	let rootPaths = vscode.workspace.workspaceFolders;
	if (rootPaths === undefined) {
		return;
	} else {
		rootPath = rootPaths[0].uri;
	}

	// Get boards
	let boardsDir = vscode.Uri.joinPath(rootPath, "zephyr/boards");
	let boards = await getBoardlist(boardsDir);

	// Prompt which board to use
	const result = await vscode.window.showQuickPick(boards, {
		placeHolder: 'Pick your board..'
	});

	if (result) {
		console.log("Changing board to " + result);
		vscode.window.showInformationMessage(`Board changed to ${result}`);
		project.board = result;
		await context.workspaceState.update("zephyr.project", project);
	}

};


async function update(config: GlobalConfig, project: ProjectConfig) {

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
		env: <{ [key: string]: string; }>config.env,
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

};

async function build(config: GlobalConfig, project: ProjectConfig, pristine: boolean, context: vscode.ExtensionContext) {

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
		env: <{ [key: string]: string; }>config.env,
	};

	// Tasks
	let taskName = "Zephyr Tools: Build";

	// Enable python env
	let cmd = `west build -b ${project.board}${pristine ? ' -p' : ''} -s "${project.target}"`;
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
		errorMessage: "Build error! Did you init your project?",
		successMessage: "Build complete!"
	});

	vscode.window.showInformationMessage(`Building for ${project.board}`);

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
	if (rootPath === undefined || project.board === undefined) {
		return;
	}

	//Get build folder
	let buildFolder = vscode.Uri.joinPath(rootPath, "build");

	// Remove build folder
	await vscode.workspace.fs.delete(buildFolder, { recursive: true, useTrash: true });

}

// this method is called when your extension is deactivated
export function deactivate() { }

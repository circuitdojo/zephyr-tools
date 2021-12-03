// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as os from 'os';
import * as downloader from "@microsoft/vscode-file-downloader-api";
import { rootCertificates } from 'tls';

type ManifestDownloadEntry = {
	name: string;
	url: string;
	md5: string;
	suffix?: string;
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

// Ignore list
let ignore = [".git", ".vscode", "build"];

// Important directories
let homedir = os.homedir();
let toolsdir = vscode.Uri.joinPath(vscode.Uri.parse(homedir), ".zephyrtools");

// Boards 
// let boards: string[] = [
// 	"circuitdojo_feather_nrf9160_ns",
// 	"sparkfun_thing_plus_nrf9160_ns",
// 	"particle_xenon"
// ];

// Project specific configuration
interface ProjectConfig {
	board?: string;
	target?: string;
	comport?: string;
}

// Config for the exention
interface GlobalConfig {
	setup: boolean,
	env: { [name: string]: string | undefined };
}

// Platform
let platform: NodeJS.Platform;

// Arch
let arch: string;

// Output Channel
let output: vscode.OutputChannel

// Terminal
let terminal: vscode.Terminal;

// Configuratoin
let config: GlobalConfig;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Get the OS info
	platform = os.platform();
	arch = os.arch();

	// Get the configuration
	config = context.globalState.get("zephyr.env") ?? { env: process.env, setup: false };

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.setup', async () => {

		// Show setup progress..
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Setting up Zephyr dependencies",
			cancellable: true
		}, async (progress, token) => {

			token.onCancellationRequested(() => {
				console.log("User canceled the long running operation");
			});

			// Create & clear output
			if (output == undefined) {
				output = vscode.window.createOutputChannel("Zephyr Tools");
			}

			// Clear output before beginning
			output.clear();
			output.show();

			// check if directory in $HOME exists
			await vscode.workspace.fs.stat(toolsdir).then(
				(value: vscode.FileStat) => {
					console.log("toolsdir found")
				},
				async (reason: any) => {
					// Otherwise create home directory
					await vscode.workspace.fs.createDirectory(toolsdir);
				});

			progress.report({ increment: 1 });

			// Promisified exec
			let exec = util.promisify(cp.exec);

			// Download dependenices first!
			const fileDownloader: downloader.FileDownloader = await downloader.getApi();

			for (const [key, value] of Object.entries(manifest)) {
				if (platform == key) {
					// For loop to process entry in manifest.json
					inner: for (const [index, element] of value.entries()) {
						// Confirm it's the correct architecture 
						if (element.arch == arch) {
							for (var download of element.downloads) {

								console.log(download.url);

								// TODO: EXTRA CREDIT -- check if already exists & hash 

								// Check if we can unzip..
								const shouldUnzip = download.url.includes(".zip");

								// Check if it already exists
								let filepath = await fileDownloader.getItem(download.filename, context).then((value) => value, (reason) => null);

								// Download if doesn't exist
								if (filepath == null) {
									output.appendLine("[SETUP] downloading " + download.url);


									filepath = await fileDownloader.downloadFile(
										vscode.Uri.parse(download.url),
										download.filename,
										context,
						/* cancellationToken */ undefined,
						/* progressCallback */ undefined,
										{ shouldUnzip: shouldUnzip }
									);
								}

								// TODO: EXTRA CREDIT - check MD5

								console.log(filepath.fsPath);

								// Get the path to copy the contents to..
								const copytopath = vscode.Uri.joinPath(toolsdir, download.name);

								// Unpack and place into `$HOME/.zephyrtools`
								if (shouldUnzip) {
									await vscode.workspace.fs.copy(filepath, copytopath, { overwrite: true });
								} else if (download.url.includes("tar")) {

									// Create copy to folder
									await vscode.workspace.fs.stat(copytopath).then(
										(value: vscode.FileStat) => {
											console.log("copytopath found")
										},
										async (reason: any) => {
											// Otherwise create home directory
											await vscode.workspace.fs.createDirectory(copytopath);
										});


									// Then untar
									const cmd = `tar -xvf "${filepath.fsPath}" -C "${copytopath.fsPath}"`;

									output.appendLine("[SETUP] extracting " + filepath.fsPath);


									let res = await exec(cmd, { env: config.env }).then(value => {
										output.append(value.stdout);
										output.append(value.stderr);
										return true;
									}, (reason) => {
										output.append(reason);

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
								let setpath = copytopath;

								// Executables to path
								if (download.suffix) {
									setpath = vscode.Uri.joinPath(setpath, download.suffix);
								}

								const envpath = vscode.Uri.joinPath(setpath, ":" + config.env["PATH"]);
								config.env["PATH"] = envpath.fsPath;

								console.log(config.env);

							};

							break inner;
						} else {

							// Check if we're at the end of arch check
							if (index == (value.length - 1)) {
								vscode.window.showErrorMessage('Unsupported architecture for Zephyr Tools!');
							}
						}
					}

					progress.report({ increment: 50 });

					// Break from loop since we found the correct platform
					break;

				} else {

					// Check if this is the last iteration 
					let platforms = Object.keys(manifest);
					let last = platforms[platforms.length - 1];

					if (last == key) {
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

			progress.report({ increment: 55 });

			// Otherwise, check Python install
			res = await exec("python3 --version", { env: config.env }).then(value => {

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

			progress.report({ increment: 60 });

			// install pip (if not already)
			res = await exec("python3 -m ensurepip", { env: config.env }).then(value => {
				output.append(value.stdout);
				output.append(value.stderr);
				output.appendLine("[SETUP] pip installed");

				return true;
			}, (reason) => {
				output.appendLine("[SETUP] unable to install pip");
				output.append(reason);

				// Error message
				vscode.window.showErrorMessage('Error installing pip. Check output for more info.');

				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			progress.report({ increment: 65 });

			// install virtualenv
			res = await exec("python3 -m pip install virtualenv", { env: config.env }).then(value => {
				output.append(value.stdout);
				output.append(value.stderr);
				output.appendLine("[SETUP] virtualenv installed");
				return true;
			}, (reason) => {
				output.appendLine("[SETUP] unable to install virtualenv");
				output.append(reason);

				// Error message
				vscode.window.showErrorMessage('Error installing virtualenv. Check output for more info.');
				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			progress.report({ increment: 70 });

			// create virtualenv within `$HOME/.zephyrtools`
			let uri = vscode.Uri.joinPath(toolsdir, "env");

			console.log("path: " + uri.fsPath);

			res = await exec(`python3 -m virtualenv ${uri.fsPath}`, { env: config.env }).then(value => {
				output.append(value.stdout);
				output.append(value.stderr);
				output.appendLine("[SETUP] virtual python environment created");
				return true;
			}, (reason) => {
				output.appendLine("[SETUP] unable to setup virtualenv");
				output.append(reason);

				// Error message
				vscode.window.showErrorMessage('Error installing virtualenv. Check output for more info.');
				return false;
			});

			// Return if error
			if (!res) {
				return;
			}

			// Report progress
			progress.report({ increment: 80 });

			// Add env/bin to path
			const envpath = vscode.Uri.joinPath(uri, "bin:" + config.env["PATH"]);
			config.env["PATH"] = envpath.fsPath;

			// Install `west`
			res = await exec(`python3 -m pip install west`, { env: config.env }).then(value => {
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

			progress.report({ increment: 90 });


			// TODO: Set the various environment variables 
			// config.env["GIT_EXEC_PATH"] = `${paths[platform]}/toolchain/Cellar/git/${gitversion}/libexec/git-core`
			config.env["ZEPHYR_TOOLCHAIN_VARIANT"] = `gnuarmemb`;
			// TODO: double check this is platform agnostic
			config.env["GNUARMEMB_TOOLCHAIN_PATH"] = vscode.Uri.joinPath(toolsdir, 'toolchain/gcc-arm-none-eabi-9-2019-q4-major').fsPath;

			console.log("env: " + JSON.stringify(config));

			output.appendLine("[SETUP] Zephyr setup complete!");

			// Setup flag complete
			config.setup = true;

			// Save this informaiton to disk
			context.globalState.update("zephyr.env", config);

			progress.report({ increment: 100 });

			vscode.window.showInformationMessage(`Zephyr Tools setup complete!`);
		});

	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.init-repo', async () => {

		// See if config is set first
		if (!config.setup) {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Setup` command before building.');
			return;
		}

		// Create output
		if (output == undefined) {
			output = vscode.window.createOutputChannel("Zephyr Tools");
		}
		output.show();

		// Promisified exec
		let exec = util.promisify(cp.exec);

		try {

			// Pick options
			const pickOptions: vscode.QuickPickOptions = {
				ignoreFocusOut: true,
				placeHolder: 'Where would you like to initialize from?'
			};


			// Options for picker
			const dialogOptions: vscode.OpenDialogOptions = {
				canSelectFiles: false,
				canSelectFolders: true,
				title: "Select destination folder."
			};

			// Open file picker for destination directory
			let dest = await vscode.window.showOpenDialog(dialogOptions);
			if (dest == undefined)
				return;

			// TODO: determine App destinationa
			let appDest = vscode.Uri.joinPath(dest[0], "app");

			// Check if .git is already here.
			let exists = await vscode.workspace.fs.stat(vscode.Uri.joinPath(appDest, ".git")).then(
				(value) => { return true },
				(reason) => { return false });

			if (!exists) {

				// Options for input box
				const inputOptions: vscode.InputBoxOptions = {
					prompt: "Enter git URL.",
					placeHolder: "https://github.com/circuitdojo/nrf9160-feather-examples-and-drivers.git",
					ignoreFocusOut: true
				};

				// Prompt for URL to init..
				let url = await vscode.window.showInputBox(inputOptions);
				if (url == undefined)
					return;

				// git clone to destination
				let cmd = `git clone ${url} ${appDest.fsPath}`;
				output.appendLine(cmd);
				let res = await exec(cmd, { env: config.env });
				if (res.stdout) {
					output.append(res.stdout);
				}

				// TODO: pick branch?

			}

			// Init repository with `west init -l`
			let cmd = `west init -l ${appDest.fsPath}`;
			output.appendLine(cmd);
			let res = await exec(cmd, { env: config.env });
			if (res.stdout) {
				output.append(res.stdout);
			}

			// `west update`
			cmd = `west update`;
			output.appendLine(cmd);
			res = await exec(cmd, { env: config.env, cwd: dest[0].fsPath });
			if (res.stdout) {
				output.append(res.stdout);
			}

			// Install python dependencies `pip install -r zephyr/requirements.txt`
			cmd = "pip install -r zephyr/scripts/requirements.txt";
			output.appendLine(cmd);
			res = await exec(cmd, { env: config.env, cwd: dest[0].fsPath });
			if (res.stdout) {
				output.append(res.stdout);
			}

			// Open workspace
			await vscode.commands.executeCommand('vscode.openFolder', dest[0]);

			// Select the project
			await changeProject(config, context);

		} catch (error) {

			let text = "";
			if (typeof error === "string") {
				text = error;
			} else if (error instanceof Error) {
				text = error.message
			}

			output.append(text);
			vscode.window.showErrorMessage(`Zephyr Tools: Init Repo error. See output for details.`);

		}

		vscode.window.showInformationMessage('Initialization of repository complete!');

	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.change-project', async () => {

		// See if config is set first
		if (config.setup) {
			changeProject(config, context);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before building.');
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.change-board', async () => {
		// See if config is set first
		if (config.setup) {
			changeBoard(config, context);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before building.');
		}

	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.select-com-port', async () => {
		// TODO: scan for available ports
		// TODO: show list and selection dialogue 
		// TODO: save to configuration
		console.log("TODO")
	}));

	// Does a pristine zephyr build
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.build-pristine', async () => {

		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

		if (config.setup && project != {}) {
			await build(config, project, true, context);
		} else if (project == {}) {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Init Project` command before building.');
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Tools: Setup` command before building.');
		}


	}));

	// Utilizes build cache (if it exists) and builds
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.build', async () => {

		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

		// Do some work
		if (config.setup && project != {}) {
			await build(config, project, false, context);
		} else if (project == {}) {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Init Project` command before building.');
		} else {
			vscode.window.showErrorMessage('Run `Zephyr Tools: Setup` command before building.');
		}


	}));

	// Flashes Zephyr project to board
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.flash', async () => {
		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

		// Flash board
		if (config.setup) {
			await flash(config, project);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));


	// Cleans the project by removing the `build` folder
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.clean', async () => {
		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

		// Flash board
		if (config.setup) {
			await clean(config, project);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));

	// Update dependencies
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.update', async () => {

		// Fetch the project config
		let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

		// Flash board
		if (config.setup) {
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

}

// TODO: select programmer ID if there are multiple..
async function flash(config: GlobalConfig, project: ProjectConfig) {

	// Create output
	if (output == undefined) {
		output = vscode.window.createOutputChannel("Zephyr Tools");
	}

	// Clear output
	output.clear();

	// Get the active workspace root path
	let rootPath = "";

	// Return if rootPath undefined
	if (rootPath == undefined) {
		return;
	}

	// Dest path
	// let destPath = `${paths[platform]}/nrf/applications/user/${workspaceName}`;
	let destPath = "";

	// Create command based on current OS
	let cmd = "";
	cmd = "west flash";

	// Process slightly differently due to how windows is setup
	if (platform == "win32") {
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
		output.dispose()
	});

}

async function getBoardlist(folder: vscode.Uri): Promise<string[]> {


	let files = await vscode.workspace.fs.readDirectory(folder);
	let boards: string[] = [];

	while (true) {

		let file = files.pop();

		// Stop looping once done.
		if (file == undefined)
			break;

		if (file[0].includes(".yaml")) {

			let uri = vscode.Uri.parse(file[0]);
			let board = file[0].substr(file[0].lastIndexOf('/') + 1).replace(".yaml", "");
			boards.push(board);

		}
		else if (file[0].includes("build") || file[0].includes(".git")) {
			// Don't do anything
		}
		else if (file[1] == vscode.FileType.Directory) {
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
		if (file == undefined)
			break;

		if (file[0].includes("CMakeLists.txt")) {

			// Check the filefolder
			let filepath = vscode.Uri.joinPath(folder, file[0]);
			let contents = await vscode.workspace.openTextDocument(filepath).then((document) => {
				return document.getText();
			});

			if (contents.includes("project(")) {
				projects.push(filepath.fsPath.replace("CMakeLists.txt", ""));
			}
		}
		else if (file[0].includes("build") || file[0].includes(".git")) {
			// Don't do anything
		}
		else if (file[1] == vscode.FileType.Directory) {
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
	let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

	// Create & clear output
	if (output == undefined) {
		output = vscode.window.createOutputChannel("Zephyr Tools");
	}

	// Get the workspace root
	let rootPath;
	let rootPaths = vscode.workspace.workspaceFolders;
	if (rootPaths == undefined) {
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
	let files = await getProjectList(vscode.Uri.joinPath(rootPath, res.stdout.trim()))
	console.log(files);

	// Turn that into a project selection 
	const result = await vscode.window.showQuickPick(files, {
		placeHolder: 'Pick your target project..'
	});

	if (result) {
		console.log("Changing project to " + result);
		vscode.window.showInformationMessage(`Project changed to ${result}`);
		project.target = result;
		context.workspaceState.update("zephyr.project", project);
	}

}

async function changeBoard(config: GlobalConfig, context: vscode.ExtensionContext) {

	// TODO: iterative function to find all possible board options
	let project: ProjectConfig = context.workspaceState.get("zephyr.project") ?? {};

	// Get the workspace root
	let rootPath;
	let rootPaths = vscode.workspace.workspaceFolders;
	if (rootPaths == undefined) {
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
		context.workspaceState.update("zephyr.project", project);
	}

};


async function update(config: GlobalConfig, project: ProjectConfig) {

	// Get the active workspace root path
	let rootPath;
	let rootPaths = vscode.workspace.workspaceFolders;
	if (rootPaths == undefined) {
		return;
	} else {
		rootPath = rootPaths[0].uri;
	}

	// Options for Shell Execution
	let options: vscode.ShellExecutionOptions = {
		executable: "bash",
		shellArgs: ["-c"],
		env: <{ [key: string]: string; }>config.env,
		cwd: rootPath.fsPath,
	}

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
	if (config.env == undefined) {
		console.log("Env is undefined!");
		return;
	}

	// Return if undefined
	if (project.board == undefined) {
		// Change board function
		await changeBoard(config, context);
	}

	// Check again..
	if (project.board == undefined) {
		vscode.window.showErrorMessage(`You must choose a board to continue.`);
		return;
	}

	// Options for SehllExecution
	let options: vscode.ShellExecutionOptions = {
		executable: "bash",
		shellArgs: ["-c"],
		env: <{ [key: string]: string; }>config.env
	}

	// Tasks
	let taskName = "Zephyr Tools: Build";
	let tasks: vscode.Task[] = [];

	// Enable python env
	let cmd = `west build -b ${project.board}${pristine ? ' -p' : ''} -s ${project.target}`;
	let exec = new vscode.ShellExecution(cmd, options);

	// Task
	let task = new vscode.Task(
		{ type: "zephyr-tools", command: taskName },
		vscode.TaskScope.Workspace,
		taskName,
		"zephyr-tools",
		exec
	);
	tasks.push(task);

	// Iterate over each task
	for (let task of tasks) {
		await vscode.tasks.executeTask(task);
	}

	vscode.window.showInformationMessage(`Building for ${project.board}`);

}

async function clean(config: GlobalConfig, project: ProjectConfig) {

	// Get the active workspace root path
	let rootPath;
	let rootPaths = vscode.workspace.workspaceFolders;
	if (rootPaths == undefined) {
		return;
	} else {
		rootPath = rootPaths[0].uri;
	}

	// Return if undefined
	if (rootPath == undefined || project.board == undefined) {
		return;
	}

	//Get build folder
	let buildFolder = vscode.Uri.joinPath(rootPath, "build");

	// Remove build folder
	await vscode.workspace.fs.delete(buildFolder, { recursive: true, useTrash: true });

}

// this method is called when your extension is deactivated
export function deactivate() { }

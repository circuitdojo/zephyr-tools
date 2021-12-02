// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as os from 'os';

// Ignore list
let ignore = [".git", ".vscode", "build"];

// Paths
let paths: { [name: string]: string } = { "darwin": "/opt/nordic/ncs", "win32": "C:\\ncs", "linux": "/opt/nordic/ncs" };

// Boards 
let boards: string[] = [
	"circuitdojo_feather_nrf9160ns"
];

// Config for the exention
interface Config {
	board?: string;
	ncsVersion?: string;
	env?: { [name: string]: string | undefined };
}

// Platform
let platform: NodeJS.Platform;

// Output Channel
let output: vscode.OutputChannel

// Terminal
let terminal: vscode.Terminal;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// TODO: download/install newtmgr 

	// Get the OS info
	platform = os.platform();

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.setup', async () => {

		// List of string
		let versions: string[] = new Array(0);

		// Depending on what platform, go to the default location and list all folders besides the `downloads` folder
		await vscode.workspace.fs.readDirectory(vscode.Uri.parse(paths[platform])).then(async (value: [string, vscode.FileType][]) => {

			// Go through and find all the valid versions
			value.forEach(element => {
				// Make sure it's not hte downloads folder or non-folder
				if (element[0] != "downloads" && element[1] == vscode.FileType.Directory) {
					versions.push(element[0]);
				}
			});

		});

		// Local config 
		let config: Config = {};
		config.env = {};

		// Prompt to choose which SDK to use
		await vscode.window.showQuickPick(versions, { placeHolder: "Pick SDK version.", canPickMany: false }).then(value => {

			// Only set when not undefined
			if (value != undefined) {
				config.ncsVersion = value;
			}

		});

		// Prompt which board to use
		await vscode.window.showQuickPick(boards, { placeHolder: "Select board.", canPickMany: false }).then(value => {

			// Only set when not undefined
			if (value != undefined) {
				config.board = value;
			}

		});

		// Git versions
		let gitVersions: [string, vscode.FileType][];

		// Final git version picked
		let gitversion: string = "";

		// Set env based on OS
		switch (platform) {
			case "win32":

				// Get all versions of git in the Toolchain
				gitVersions = await vscode.workspace.fs.readDirectory(vscode.Uri.parse(`${paths[platform]}\\${config.ncsVersion}\\Cellar\\git`));

				// Get the first version
				for (let ver of gitVersions) {
					if (ver[1] == vscode.FileType.Directory) {
						gitversion = ver[0];
						break;
					}
				}

				break;
			case "linux":

				// TODO: build this out
				// `PATH=${toolchainDir}/bin:${toolchainDir}/usr/bin:${toolchainDir}/segger_embedded_studio/bin:${remote.process.env.PATH}`,
				// `PYTHONHOME=${toolchainDir}/lib/python3.8`,
				// `PYTHONPATH=${toolchainDir}/usr/lib/python3.8:${toolchainDir}/lib/python3.8/site-packages:${toolchainDir}/usr/lib/python3/dist-packages:${toolchainDir}/usr/lib/python3.8/lib-dynload`,
				// `GIT_EXEC_PATH=${toolchainDir}/usr/lib/git-core`,
				// `LD_LIBRARY_PATH=/var/lib/snapd/lib/gl:/var/lib/snapd/lib/gl32:/var/lib/snapd/void:${toolchainDir}/lib/python3.8/site-packages/.libs_cffi_backend:${toolchainDir}/lib/python3.8/site-packages/Pillow.libs:${toolchainDir}/lib/x86_64-linux-gnu:${toolchainDir}/segger_embedded_studio/bin:${toolchainDir}/usr/lib/x86_64-linux-gnu:${toolchainDir}/lib:${toolchainDir}/usr/lib:${toolchainDir}/lib/x86_64-linux-gnu:${toolchainDir}/usr/lib/x86_64-linux-gnu`

				break;
			case "darwin":

				// Get all versions of git in the Toolchain
				gitVersions = await vscode.workspace.fs.readDirectory(vscode.Uri.parse(`${paths[platform]}/${config.ncsVersion}/toolchain/Cellar/git`));

				// Get the first version
				for (let ver of gitVersions) {
					if (ver[1] == vscode.FileType.Directory) {
						gitversion = ver[0];
						break;
					}
				}

				// Se the various environment variables 
				config.env = process.env;
				config.env["PATH"] = `${paths[platform]}/${config.ncsVersion}/toolchain/bin:${config.env["PATH"]}`;
				config.env["GIT_EXEC_PATH"] = `${paths[platform]}/${config.ncsVersion}/toolchain/Cellar/git/${gitversion}/libexec/git-core`
				config.env["ZEPHYR_TOOLCHAIN_VARIANT"] = `gnuarmemb`
				config.env["GNUARMEMB_TOOLCHAIN_PATH"] = `${paths[platform]}/${config.ncsVersion}/toolchain/`

				console.log("env: " + JSON.stringify(config));
				break;
			default:
				vscode.window.showErrorMessage('Unsupported platform for Zephyr Tools!');
				return;
		}

		// Save this informaiton to disk
		context.workspaceState.update("config", config);


	}));

	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.reinstall', async () => {
		// TODO: do stuff here.
		console.log("TODO")
	}));

	// Does a pristine zephyr build
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.build-pristine', async () => {

		// Fetch the board and NCS version
		let config: Config = context.workspaceState.get("config") ?? {};

		// Do some work
		if (config != {}) {
			await build(config, true);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before building.');
		}


	}));

	// Utilizes build cache (if it exists) and builds
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.build', async () => {

		// Fetch the board and NCS version
		let config: Config = context.workspaceState.get("config") ?? {};

		// Do some work
		if (config != {}) {
			await build(config, false);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before building.');
		}


	}));

	// Flashes Zephyr project to board
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.flash', async () => {
		// Fetch the board and NCS version
		let config: Config = context.workspaceState.get("config") ?? {};

		// Flash board
		if (config != {}) {
			await flash(config);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));


	// Cleans the project by removing the `build` folder
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.clean', async () => {
		// Fetch the board and NCS version
		let config: Config = context.workspaceState.get("config") ?? {};

		// Flash board
		if (config != {}) {
			await clean(config);
		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));

	// TODO: command for creating terminal for command line work (with added env)
	context.subscriptions.push(vscode.commands.registerCommand('zephyr-tools.terminal', async () => {
		// Fetch the board and NCS version
		let config: Config = context.workspaceState.get("config") ?? {};

		// Flash board
		if (config != {}) {

			let rootPath = await getRootPath();

			// Return if rootPath undefined
			if (rootPath == undefined || config.env == undefined) {
				vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
				return;
			}

			// Create a terminal session
			let options: vscode.TerminalOptions = {
				env: <{ [name: string]: string | null }>config.env, name: "Zephyr SDK", cwd: rootPath
			};
			terminal = vscode.window.createTerminal(options);
			terminal.show();


		} else {
			// Display an error message box to the user
			vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before flashing.');
		}
	}));

	// TODO: command for loading via `newtmgr`

	// TODO: install command for installing versions of the sdk. (pulls manifest from Nordic's servers)

}

// sharable getRootPath function
async function getRootPath(): Promise<string | undefined> {

	// Get the workspace root
	let rootPaths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.path);

	// Search each rootPath to see if there is a Cmakelists.txt
	if (rootPaths == undefined) {
		vscode.window.showErrorMessage('Please open your project first!');
		return;
	}

	let rootPath = "";

	// Determine if the directory is buildable
	for (let element of rootPaths) {
		await vscode.workspace.fs.readDirectory(vscode.Uri.parse(element)).then((value) => {

			// Iterate each entry
			for (let entry of value) {
				if (entry[0] == "CMakeLists.txt" && entry[1] == vscode.FileType.File) {
					rootPath = element;
					break;
				}
			}
		});

		// Set the root path
		if (rootPath != "") {
			break;
		}

	}

	// Check if the root path is still not defined
	if (rootPath == "") {
		vscode.window.showErrorMessage('Zephyr project not found!');
		return;
	}

	return rootPath;
}

// TODO: select programmer ID if there are multiple..
async function flash(config: Config) {

	// Create output
	if (output == undefined) {
		output = vscode.window.createOutputChannel("Zephyr SDK");
	}

	// Clear output
	output.clear();

	// Get the active workspace root path
	let rootPath = await getRootPath();
	let workspaceName = vscode.workspace.name;

	// Return if rootPath undefined
	if (rootPath == undefined) {
		return;
	}

	// Dest path
	let destPath = `${paths[platform]}/${config.ncsVersion}/nrf/applications/user/${workspaceName}`;

	// Create command based on current OS
	let cmd = "";
	cmd = "west flash";

	// Process slightly differently due to how windows is setup
	if (platform == "win32") {
		cmd = `${paths["win"]}\\${config.ncsVersion}\\toolchain\\git-bash.exe -c "cd ${rootPath} && ${cmd}"`
	}

	// Show output as things begin.
	output.show();

	// Promisified exec
	let exec = util.promisify(cp.exec);

	// TOOO: handle real-time stream during build
	// Show we're building..
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Flashing board!",
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
	});

}

// Syncs files based on timestamp.
// Ignores .vscode and build folders
async function syncFolders(config: Config, source: string, dest: string) {

	console.log("Syncing " + source + " to: " + dest);

	// Create dest folder (errors ignored)
	await vscode.workspace.fs.createDirectory(vscode.Uri.parse(dest));

	// TODO: check if source is a folder(?)

	let contents = await vscode.workspace.fs.readDirectory(vscode.Uri.parse(source));

	for (let entry of contents) {

		// Check if entry is in ignore list
		if (ignore.includes(entry[0])) {
			console.log("Ignoring: " + entry[0]);
			continue;
		}

		// Then depending on what the file is do stuff
		switch (entry[1]) {
			case vscode.FileType.Directory:

				// Get the Uris
				let sourceFolder = source + "/" + entry[0];
				let destFolder = dest + "/" + entry[0];

				// Recurse (barf) the subfolder
				await syncFolders(config, sourceFolder, destFolder);

				break;
			case vscode.FileType.File:

				console.log("Filename: " + entry[0]);

				// Get the Uris
				let sourceFile = vscode.Uri.parse(source + "/" + entry[0]);
				let destFile = vscode.Uri.parse(dest + "/" + entry[0]);

				// Get source stat
				let sourceStat = await vscode.workspace.fs.stat(sourceFile);

				// check if destination has it
				let destStat = await vscode.workspace.fs.stat(destFile).then((value) => {
					return value;
				}, (reason) => {
					console.log("File stat error: " + reason);
					return undefined;
				});

				// compare stat results
				if ((destStat != undefined && sourceStat.mtime > destStat.mtime) ||
					destStat == undefined) {

					console.log("Copying " + entry[0]);

					// copy it to the dest
					await vscode.workspace.fs.copy(sourceFile, destFile, { overwrite: true });

				}

				break;
			default:
				continue;
		}

	}

}

async function build(config: Config, pristine: boolean) {

	// Create output
	if (output == undefined) {
		output = vscode.window.createOutputChannel("Zephyr SDK");
	}

	// Clear output
	output.clear();

	// Get the active workspace root path
	let rootPath = await getRootPath();
	let workspaceName = vscode.workspace.name;
	let sync = false

	// Return if undefined
	if (rootPath == undefined || config.board == undefined || config.ncsVersion == undefined) {
		vscode.window.showErrorMessage('Run `Zephyr Toools: Setup` command before building.');
		return;
	}

	// Dest path
	let destPath: string = rootPath;

	// Only sync folders if the root path is not within the SDK path.
	if (!rootPath.includes(`${paths[platform]}/${config.ncsVersion}`)) {
		// Set sync flag
		sync = true;

		// Set destpath
		destPath = `${paths[platform]}/${config.ncsVersion}/nrf/applications/user/${workspaceName}`;

		// Sync source with destiation within NCS
		await syncFolders(config, rootPath, destPath);
	}

	// Promisified exec
	let exec = util.promisify(cp.exec);

	// Create command based on current OS
	let cmd = "";
	cmd = `west build -b ${config.board}${pristine ? ' -p' : ''}`;

	// Process slightly differently due to how windows is setup
	if (platform == "win32") {
		cmd = `${paths["win"]}\\${config.ncsVersion}\\toolchain\\git-bash.exe --login -c "cd ${rootPath} && ${cmd}"`
	}

	// TOOO: handle real-time stream during build (i.e. pipe line by line progress..)
	// Show we're building..
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Running build!",
		cancellable: false
	}, async (progress, token) => {

		token.onCancellationRequested(() => {
			console.log("User canceled the long running operation");
		});

		console.info(rootPath + " " + JSON.stringify(config.env));

		// Execute the task
		await exec(cmd, { cwd: destPath, env: config.env }).then(value => {
			output.append(value.stdout);
			output.append(value.stderr);
			output.show();
		}, (reason) => {
			output.append(reason.stderr);
			console.error(reason);
			// Error message
			vscode.window.showErrorMessage('Error flashing. Check output for more info.');
			// Show output
			output.show();
		});

		progress.report({ increment: 100 });
	});

	console.debug("Copy " + destPath + "/build to " + rootPath);

	// Copy back build output
	if (sync) {
		await vscode.workspace.fs.copy(vscode.Uri.parse(destPath + "/build"), vscode.Uri.parse(rootPath + "/build"), { overwrite: true }).then(() => {

		}, (reason) => {
			console.error(reason.stdout);
			console.error(reason.stderr);
		});
	}

}

async function clean(config: Config) {

	// Create output
	if (output == undefined) {
		output = vscode.window.createOutputChannel("Zephyr SDK");
	}

	// Clear output
	output.clear();

	// Get the active workspace root path
	let rootPath = await getRootPath();
	let workspaceName = vscode.workspace.name;

	// Return if undefined
	if (rootPath == undefined || config.board == undefined || config.ncsVersion == undefined) {
		return;
	}

	// Dest path
	let destPath = `${paths[platform]}/${config.ncsVersion}/nrf/applications/user/${workspaceName}`;

	// Set the path
	let path = rootPath + "/build";
	if (platform == "win32") {
		path = rootPath + "\\build";
	}

	// Remove build folder
	await vscode.workspace.fs.delete(vscode.Uri.parse(rootPath + "/build"), { recursive: true, useTrash: true });
	await vscode.workspace.fs.delete(vscode.Uri.parse(destPath), { recursive: true, useTrash: true });

}

// this method is called when your extension is deactivated
export function deactivate() { }

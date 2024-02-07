
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as unzip from 'node-stream-zip';
import { fileURLToPath } from 'url';

export async function get_dest(_dest: vscode.Uri | undefined): Promise<vscode.Uri | null> {

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
            vscode.window.showErrorMessage('Provide a target folder.');
            return null;
        }

        // Get fsPath
        open[0].fsPath;

        // Copy it over
        dest = open[0];
    }

    return dest;
}

function checkFileExistsSync(filepath: string) {
    let flag = true;
    try {
        fs.accessSync(filepath, fs.constants.F_OK);
    } catch (e) {
        flag = false;
    }
    return flag;
}

export function create_dir_if_not_exist(directory: string): void {
    // check if directory in $HOME exists
    let exists = fs.pathExistsSync(directory);
    if (!exists) {
        console.log('${directory} not found -> created');
        // Otherwise create home directory
        fs.mkdirpSync(directory);
    }
}

export function find_file(file: string): string {
    let sources = ["../manifest", path.join(os.homedir(), ".zephyrtools")];

    if (vscode.workspace.workspaceFolders) {
        sources.push(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "app"));
    }

    for (let index = sources.length; index > 0; index--) {
        let fullpath = path.join(sources[index - 1], file);
        if (checkFileExistsSync(fullpath)) {
            return fullpath;
        }
    }

    return path.join(sources[0], file);
}

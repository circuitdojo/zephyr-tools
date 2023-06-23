
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as unzip from 'node-stream-zip';

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
/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { YamlParser } from "../utils";

export class ProjectScanner {
  static async getProjectList(folder: vscode.Uri): Promise<string[]> {
    const files = await vscode.workspace.fs.readDirectory(folder);
    const projects: string[] = [];

    const queue = [...files.map(([name, type]) => ({ name, type, path: folder }))];

    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;

      if (file.name.includes("CMakeLists.txt")) {
        // Check the file content
        const filepath = vscode.Uri.joinPath(file.path, file.name);
        try {
          const contents = await vscode.workspace.openTextDocument(filepath).then(document => {
            return document.getText();
          });

          if (contents.includes("project(")) {
            const project = path.parse(filepath.fsPath);
            projects.push(project.dir);
          }
        } catch (error) {
          console.error(`Error reading ${filepath.fsPath}:`, error);
        }
      } else if (file.name.includes("build") || file.name.includes(".git")) {
        // Skip these directories
        continue;
      } else if (file.type === vscode.FileType.Directory) {
        try {
          const subPath = vscode.Uri.joinPath(file.path, file.name);
          const subfolders = await vscode.workspace.fs.readDirectory(subPath);
          
          for (const [subName, subType] of subfolders) {
            queue.push({
              name: path.join(file.name, subName),
              type: subType,
              path: file.path
            });
          }
        } catch (error) {
          console.error(`Error reading directory ${file.name}:`, error);
        }
      }
    }

    return projects;
  }

  static async getBoardList(folder: vscode.Uri): Promise<string[]> {
    const result: string[] = [];
    const foldersToIgnore = ["build", ".git", "bindings"];

    const folderQueue: string[] = [folder.fsPath];

    while (folderQueue.length > 0) {
      const currentFolder = folderQueue.shift() as string;

      try {
        // Check if board.yml exists in currentFolder
        const boardYamlPath = path.join(currentFolder, "board.yml");
        if (fs.existsSync(boardYamlPath)) {
          try {
            const boards = await YamlParser.parseBoardYaml(boardYamlPath);
            result.push(...boards);
          } catch (error) {
            console.error(`Error parsing board YAML ${boardYamlPath}:`, error);
            // Fallback to folder name
            const folderName = path.basename(currentFolder);
            result.push(folderName);
          }
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
              const name = path.parse(filePath).name;

              // Add name to result
              result.push(name);
            }
          }
        }
      } catch (error) {
        console.error(`Error scanning folder ${currentFolder}:`, error);
      }
    }

    return result;
  }

  static async findFilesByPattern(rootDir: string, pattern: RegExp): Promise<string[]> {
    const results: string[] = [];
    
    try {
      const scanDirectory = async (dir: string) => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          
          if (item.isDirectory()) {
            // Skip common directories we don't want to scan
            if (!["node_modules", ".git", "build", ".vscode"].includes(item.name)) {
              await scanDirectory(fullPath);
            }
          } else if (item.isFile() && pattern.test(item.name)) {
            results.push(fullPath);
          }
        }
      };
      
      await scanDirectory(rootDir);
    } catch (error) {
      console.error(`Error scanning directory ${rootDir}:`, error);
    }
    
    return results;
  }

  static async findCMakeProjects(rootDir: string): Promise<string[]> {
    const cmakeFiles = await this.findFilesByPattern(rootDir, /^CMakeLists\.txt$/);
    const projects: string[] = [];
    
    for (const cmakeFile of cmakeFiles) {
      try {
        const content = await fs.readFile(cmakeFile, 'utf8');
        if (content.includes('project(')) {
          projects.push(path.dirname(cmakeFile));
        }
      } catch (error) {
        console.error(`Error reading CMakeLists.txt at ${cmakeFile}:`, error);
      }
    }
    
    return projects;
  }

  static async findSourceFiles(rootDir: string, extensions: string[] = ['.c', '.cpp', '.h', '.hpp']): Promise<string[]> {
    const sourceFiles: string[] = [];
    const extensionPattern = new RegExp(`\\.(${extensions.map(ext => ext.replace('.', '')).join('|')})$`, 'i');
    
    return this.findFilesByPattern(rootDir, extensionPattern);
  }
}

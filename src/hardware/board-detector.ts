/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { YamlParser } from "../utils";

export interface BoardInfo {
  name: string;
  arch: string;
  vendor?: string;
  soc?: string;
  variants?: string[];
  path: string;
}

export class BoardDetector {
  static async detectBoards(rootDirectory: vscode.Uri): Promise<BoardInfo[]> {
    const boards: BoardInfo[] = [];
    const boardDirectories = await this.findBoardDirectories(rootDirectory);

    for (const boardDir of boardDirectories) {
      const boardsInDir = await this.scanBoardDirectory(boardDir);
      boards.push(...boardsInDir);
    }

    return boards;
  }

  private static async findBoardDirectories(rootDirectory: vscode.Uri): Promise<string[]> {
    const boardDirectories: string[] = [];
    
    try {
      const files = await vscode.workspace.fs.readDirectory(rootDirectory);
      
      for (const [fileName, fileType] of files) {
        if (fileType === vscode.FileType.Directory && !fileName.startsWith('.')) {
          const boardsPath = path.join(rootDirectory.fsPath, fileName, 'boards');
          
          if (await fs.pathExists(boardsPath)) {
            boardDirectories.push(boardsPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error finding board directories in ${rootDirectory.fsPath}:`, error);
    }

    return boardDirectories;
  }

  private static async scanBoardDirectory(boardDirectory: string): Promise<BoardInfo[]> {
    const boards: BoardInfo[] = [];
    const foldersToIgnore = ["build", ".git", "bindings"];

    try {
      const scanQueue: string[] = [boardDirectory];

      while (scanQueue.length > 0) {
        const currentDir = scanQueue.shift()!;
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory() && !foldersToIgnore.includes(entry.name)) {
            scanQueue.push(fullPath);
          } else if (entry.isFile()) {
            if (entry.name === 'board.yml') {
              // Parse the board.yml file
              const boardsFromYaml = await this.parseBoardYaml(fullPath);
              boards.push(...boardsFromYaml);
            } else if (entry.name.endsWith('.yaml') && entry.name !== 'board.yml') {
              // Legacy board definition
              const boardName = path.parse(entry.name).name;
              boards.push({
                name: boardName,
                arch: 'unknown',
                path: fullPath
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning board directory ${boardDirectory}:`, error);
    }

    return boards;
  }

  private static async parseBoardYaml(yamlPath: string): Promise<BoardInfo[]> {
    try {
      // Use YamlParser to get board names
      const boardNames = await YamlParser.parseBoardYaml(yamlPath);
      
      return boardNames.map(name => ({
        name,
        arch: 'detected', // YamlParser should provide this
        path: yamlPath
      }));
    } catch (error) {
      console.error(`Error parsing board YAML ${yamlPath}:`, error);
      return [];
    }
  }

  static async getBoardsForArchitecture(rootDirectory: vscode.Uri, architecture: string): Promise<BoardInfo[]> {
    const allBoards = await this.detectBoards(rootDirectory);
    return allBoards.filter(board => board.arch === architecture);
  }

  static async searchBoardsByName(rootDirectory: vscode.Uri, searchTerm: string): Promise<BoardInfo[]> {
    const allBoards = await this.detectBoards(rootDirectory);
    const lowerSearchTerm = searchTerm.toLowerCase();
    
    return allBoards.filter(board => 
      board.name.toLowerCase().includes(lowerSearchTerm) ||
      board.vendor?.toLowerCase().includes(lowerSearchTerm) ||
      board.soc?.toLowerCase().includes(lowerSearchTerm)
    );
  }

  static async validateBoardExists(rootDirectory: vscode.Uri, boardName: string): Promise<boolean> {
    const allBoards = await this.detectBoards(rootDirectory);
    return allBoards.some(board => board.name === boardName);
  }

  static async getBoardInfo(rootDirectory: vscode.Uri, boardName: string): Promise<BoardInfo | undefined> {
    const allBoards = await this.detectBoards(rootDirectory);
    return allBoards.find(board => board.name === boardName);
  }
}

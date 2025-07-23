/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as path from "path";
import * as os from "os";
import { platform } from "../config";

export class PathUtils {
  static normalizePath(inputPath: string): string {
    return path.normalize(inputPath);
  }

  static joinPaths(...paths: string[]): string {
    return path.join(...paths);
  }

  static getRelativePath(from: string, to: string): string {
    return path.relative(from, to);
  }

  static getAbsolutePath(inputPath: string): string {
    return path.resolve(inputPath);
  }

  static getHomeDirectory(): string {
    return os.homedir();
  }

  static getTempDirectory(): string {
    return os.tmpdir();
  }

  static getPathSeparator(): string {
    return path.sep;
  }

  static getPathDelimiter(): string {
    return path.delimiter;
  }

  static isAbsolute(inputPath: string): boolean {
    return path.isAbsolute(inputPath);
  }

  static getDirectory(filePath: string): string {
    return path.dirname(filePath);
  }

  static getFileName(filePath: string): string {
    return path.basename(filePath);
  }

  static getFileNameWithoutExtension(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
  }

  static getFileExtension(filePath: string): string {
    return path.extname(filePath);
  }

  static changeExtension(filePath: string, newExtension: string): string {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath, path.extname(filePath));
    return path.join(dir, name + newExtension);
  }

  static convertToUnixPath(inputPath: string): string {
    return inputPath.replace(/\\/g, '/');
  }

  static convertToWindowsPath(inputPath: string): string {
    return inputPath.replace(/\//g, '\\');
  }

  static convertPathForPlatform(inputPath: string): string {
    if (platform === "win32") {
      return this.convertToWindowsPath(inputPath);
    } else {
      return this.convertToUnixPath(inputPath);
    }
  }

  static isPathsEqual(path1: string, path2: string): boolean {
    const normalizedPath1 = path.resolve(path1);
    const normalizedPath2 = path.resolve(path2);
    
    if (platform === "win32") {
      return normalizedPath1.toLowerCase() === normalizedPath2.toLowerCase();
    } else {
      return normalizedPath1 === normalizedPath2;
    }
  }

  static containsPath(parentPath: string, childPath: string): boolean {
    const normalizedParent = path.resolve(parentPath);
    const normalizedChild = path.resolve(childPath);
    
    const relativePath = path.relative(normalizedParent, normalizedChild);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  static findCommonPath(paths: string[]): string {
    if (paths.length === 0) return "";
    if (paths.length === 1) return path.dirname(paths[0]);

    const resolvedPaths = paths.map(p => path.resolve(p));
    const splitPaths = resolvedPaths.map(p => p.split(path.sep));
    
    let commonPath = splitPaths[0];
    
    for (let i = 1; i < splitPaths.length; i++) {
      const currentPath = splitPaths[i];
      const newCommonPath = [];
      
      for (let j = 0; j < Math.min(commonPath.length, currentPath.length); j++) {
        if (platform === "win32") {
          if (commonPath[j].toLowerCase() === currentPath[j].toLowerCase()) {
            newCommonPath.push(commonPath[j]);
          } else {
            break;
          }
        } else {
          if (commonPath[j] === currentPath[j]) {
            newCommonPath.push(commonPath[j]);
          } else {
            break;
          }
        }
      }
      
      commonPath = newCommonPath;
    }
    
    return commonPath.join(path.sep);
  }

  static makePathRelativeToHome(inputPath: string): string {
    const homedir = os.homedir();
    const absolutePath = path.resolve(inputPath);
    
    if (this.containsPath(homedir, absolutePath)) {
      return "~" + path.sep + path.relative(homedir, absolutePath);
    }
    
    return inputPath;
  }

  static expandTildeInPath(inputPath: string): string {
    if (inputPath.startsWith("~")) {
      return path.join(os.homedir(), inputPath.slice(1));
    }
    return inputPath;
  }
}

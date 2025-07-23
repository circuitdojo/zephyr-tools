/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs-extra";
import * as unzip from "node-stream-zip";
import * as sevenzip from "7zip-bin";
import * as node7zip from "node-7z";
import * as util from "util";
import * as cp from "child_process";
import { platform } from "../config";

export class ArchiveExtractor {
  static async extractZip(source: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const zip = new unzip.async({ file: source });
        
        zip.on("extract", (entry, file) => {
          // Make executable on non-Windows platforms
          if (platform !== "win32") {
            fs.chmodSync(file, 0o755);
          }
        });

        zip.extract(null, destination)
          .then(() => {
            zip.close();
            resolve();
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  static async extract7z(source: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const myStream = node7zip.extractFull(source, destination, {
          $bin: sevenzip.path7za,
        });

        myStream.on('error', (err) => {
          console.error('7z extraction error:', err);
          reject(err);
        });

        myStream.on('end', () => {
          console.log('7z extraction completed');
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  static async extractTar(source: string, destination: string): Promise<void> {
    const exec = util.promisify(cp.exec);
    
    try {
      // Use native tar command for better compatibility
      const cmd = `tar -xf "${source}" -C "${destination}"`;
      console.log(`Executing tar command: ${cmd}`);
      
      const result = await exec(cmd);
      if (result.stderr) {
        console.log(`Tar extraction stderr: ${result.stderr}`);
      }
      
      // Make extracted files executable on non-Windows platforms
      if (platform !== "win32") {
        try {
          await exec(`find "${destination}" -type f -exec chmod +x {} \;`);
        } catch (chmodError) {
          // Don't fail extraction if chmod fails
          console.log(`chmod warning: ${chmodError}`);
        }
      }
    } catch (error) {
      throw new Error(`Tar extraction failed: ${error}`);
    }
  }

  static async validateExtraction(extractionPath: string): Promise<boolean> {
    try {
      if (!(await fs.pathExists(extractionPath))) {
        console.log(`Extraction validation failed: ${extractionPath} does not exist`);
        return false;
      }

      const extractedFiles = await fs.readdir(extractionPath);
      if (extractedFiles.length === 0) {
        console.log(`Extraction validation failed: No files extracted to ${extractionPath}`);
        return false;
      }

      console.log(`Extraction validated: ${extractedFiles.length} items extracted`);
      return true;
    } catch (error) {
      console.log(`Extraction validation error: ${error}`);
      return false;
    }
  }

  static async extractArchive(source: string, destination: string): Promise<boolean> {
    try {
      // Ensure destination directory exists
      await fs.mkdirp(destination);

      const sourceLower = source.toLowerCase();
      
      if (sourceLower.endsWith('.zip')) {
        await this.extractZip(source, destination);
      } else if (sourceLower.endsWith('.7z')) {
        await this.extract7z(source, destination);
      } else if (sourceLower.endsWith('.tar.gz') || 
                 sourceLower.endsWith('.tar.xz') ||
                 sourceLower.includes('.tar')) {
        // Use native tar for tar files on Linux/macOS, 7z on Windows
        if (platform === "win32") {
          await this.extract7z(source, destination);
        } else {
          await this.extractTar(source, destination);
        }
      } else {
        throw new Error(`Unsupported archive format: ${source}`);
      }

      // Validate extraction
      return await this.validateExtraction(destination);
    } catch (error) {
      console.error(`Archive extraction failed: ${error}`);
      return false;
    }
  }
}

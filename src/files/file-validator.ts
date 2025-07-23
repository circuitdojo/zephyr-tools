/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs-extra";
import * as crypto from "crypto";
import * as path from "path";

export class FileValidator {
  static async validateMd5(filePath: string, expectedMd5: string): Promise<boolean> {
    try {
      if (!(await fs.pathExists(filePath))) {
        console.log(`File doesn't exist: ${filePath}`);
        return false;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const hashSum = crypto.createHash('md5');
      hashSum.update(fileBuffer);
      const hex = hashSum.digest('hex');

      const isValid = hex === expectedMd5;
      if (!isValid) {
        console.log(`MD5 mismatch for ${filePath}. Expected: ${expectedMd5}, Got: ${hex}`);
      }

      return isValid;
    } catch (error) {
      console.error(`MD5 validation error for ${filePath}:`, error);
      return false;
    }
  }

  static async validateSha256(filePath: string, expectedSha256: string): Promise<boolean> {
    try {
      if (!(await fs.pathExists(filePath))) {
        console.log(`File doesn't exist: ${filePath}`);
        return false;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      const hex = hashSum.digest('hex');

      const isValid = hex === expectedSha256;
      if (!isValid) {
        console.log(`SHA256 mismatch for ${filePath}. Expected: ${expectedSha256}, Got: ${hex}`);
      }

      return isValid;
    } catch (error) {
      console.error(`SHA256 validation error for ${filePath}:`, error);
      return false;
    }
  }

  static async validateFileSize(filePath: string, expectedSize: number): Promise<boolean> {
    try {
      if (!(await fs.pathExists(filePath))) {
        console.log(`File doesn't exist: ${filePath}`);
        return false;
      }

      const stats = await fs.stat(filePath);
      const isValid = stats.size === expectedSize;
      
      if (!isValid) {
        console.log(`File size mismatch for ${filePath}. Expected: ${expectedSize}, Got: ${stats.size}`);
      }

      return isValid;
    } catch (error) {
      console.error(`File size validation error for ${filePath}:`, error);
      return false;
    }
  }

  static async validateFileExists(filePath: string): Promise<boolean> {
    try {
      return await fs.pathExists(filePath);
    } catch (error) {
      console.error(`File existence validation error for ${filePath}:`, error);
      return false;
    }
  }

  static async validateDirectory(dirPath: string): Promise<boolean> {
    try {
      if (!(await fs.pathExists(dirPath))) {
        return false;
      }

      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      console.error(`Directory validation error for ${dirPath}:`, error);
      return false;
    }
  }

  static async validateDirectoryNotEmpty(dirPath: string): Promise<boolean> {
    try {
      if (!(await this.validateDirectory(dirPath))) {
        return false;
      }

      const files = await fs.readdir(dirPath);
      return files.length > 0;
    } catch (error) {
      console.error(`Directory content validation error for ${dirPath}:`, error);
      return false;
    }
  }

  static getFileExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
  }

  static async validateFilePermissions(filePath: string, expectedMode: number): Promise<boolean> {
    try {
      if (!(await fs.pathExists(filePath))) {
        return false;
      }

      const stats = await fs.stat(filePath);
      const actualMode = stats.mode & parseInt('777', 8);
      return actualMode === expectedMode;
    } catch (error) {
      console.error(`File permissions validation error for ${filePath}:`, error);
      return false;
    }
  }
}

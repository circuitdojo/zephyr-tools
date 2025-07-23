/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { HttpClient } from "typed-rest-client/HttpClient";

export class FileDownloader {
  private static downloadsdir: string = "";

  // Set the download target directory
  public static init(dir: string) {
    this.downloadsdir = dir;
  }

  // Check if file exists
  public static async exists(file: string): Promise<string | null> {
    const dest = path.join(this.downloadsdir, file);

    if (await fs.pathExists(dest)) {
      return dest;
    } else {
      return null;
    }
  }

  // Compares file with provided hash
  public static async check(file: string, hash: string): Promise<boolean> {
    const dest = path.join(this.downloadsdir, file);

    // Check if exists first
    if (!await fs.pathExists(dest)) {
      console.log("doesn't exist! " + dest);
      return false;
    }

    // Get file contents 
    const fileBuffer = fs.readFileSync(dest);

    // Create hash
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);

    // Get hex representation 
    const hex = hashSum.digest('hex');

    return hex === hash;
  }

  // Delete files in download directory
  public static async clean() {
    await fs.remove(this.downloadsdir);
  }

  // Downloads file to filestore with progress reporting
  public static async downloadWithProgress(
    url: string, 
    onProgress?: (progress: { percent: number; downloaded: number; total: number }) => void
  ): Promise<string> {
    const client = new HttpClient("download");
    const response = await client.get(url);

    // Get file name
    const filename = path.basename(url);

    // Determine dest
    const dest = path.join(this.downloadsdir, filename);

    // Make sure downloadsdir exists
    let exists = await fs.pathExists(this.downloadsdir);
    if (!exists) {
      console.log("downloadsdir not found");
      await fs.mkdirp(this.downloadsdir);
    }

    if (response.message.statusCode !== 200) {
      const err: Error = new Error(`Unexpected HTTP response: ${response.message.statusCode}`);
      throw err;
    }

    return new Promise((resolve, reject) => {
      const file: NodeJS.WritableStream = fs.createWriteStream(dest);
      const contentLength = parseInt(response.message.headers['content-length'] as string || '0');
      let downloaded = 0;

      file.on("error", (err) => reject(err));

      response.message.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && contentLength > 0) {
          onProgress({
            percent: (downloaded / contentLength) * 100,
            downloaded,
            total: contentLength
          });
        }
      });

      const stream = response.message.pipe(file);
      stream.on("close", () => {
        try { 
          resolve(dest); 
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  // Downloads file to filestore (backward compatibility)
  public static async fetch(url: string): Promise<string> {
    return this.downloadWithProgress(url);
  }

  // Validate checksum of downloaded file
  public static async validateChecksum(file: string, expectedMd5: string): Promise<boolean> {
    return this.check(file, expectedMd5);
  }
}

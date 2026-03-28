/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Parse CMakeCache.txt content into a Map of variable names to values.
 * Format: NAME:TYPE=VALUE (lines starting with # or // are comments)
 */
export function parseCMakeCache(content: string): Map<string, string> {
  const cache = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }
    // Match NAME:TYPE=VALUE
    const match = trimmed.match(/^([^:]+):[^=]+=(.*)$/);
    if (match) {
      cache.set(match[1], match[2]);
    }
  }
  return cache;
}

/**
 * Read and parse CMakeCache.txt from a build directory.
 * Returns undefined if the file doesn't exist.
 */
export async function readCMakeCache(buildDir: string): Promise<Map<string, string> | undefined> {
  const cachePath = path.join(buildDir, "CMakeCache.txt");
  try {
    const content = fs.readFileSync(cachePath, "utf-8");
    return parseCMakeCache(content);
  } catch {
    return undefined;
  }
}

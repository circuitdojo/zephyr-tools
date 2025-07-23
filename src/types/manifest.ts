/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

export interface ManifestEnvEntry {
  name: string;
  value?: string;
  usepath: boolean;
  append: boolean;
  suffix?: string;
}

export interface CmdEntry {
  cmd: string;
  usepath: boolean;
}

export interface ManifestToolchainEntry {
  name: string;
  downloads: ManifestDownloadEntry[];
}

export interface ManifestDownloadEntry {
  name: string;
  url: string;
  md5: string;
  suffix?: string;
  env?: ManifestEnvEntry[];
  cmd?: CmdEntry[];
  filename: string;
  clear_target?: boolean;
  copy_to_subfolder?: string;
}

export interface ManifestEntry {
  arch: string;
  toolchains: ManifestToolchainEntry[];
  downloads: ManifestDownloadEntry[];
}

export interface Manifest {
  version: Number;
  win32: ManifestEntry[];
  darwin: ManifestEntry[];
  linux: ManifestEntry[];
}

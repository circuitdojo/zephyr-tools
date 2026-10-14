/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "yaml";
import { hexRanges, mergeHexTexts, rangesOverlap } from "./intel-hex";

/**
 * Resolve what probe-rs should program for a build.
 *
 * - Partition Manager builds (NCS <= 3.4): `merged.hex` holds every image, in
 *   `zephyr/` (child images) or the build root (sysbuild). Detected from the
 *   build's current `zephyr/.config`, not from files on disk, since an SDK
 *   upgrade without a pristine build leaves the old `partitions.yml` and
 *   `merged.hex` behind.
 * - Sysbuild without Partition Manager (NCS 3.5+, vanilla Zephyr): each image
 *   in `domains.yaml` `flash_order` names its hex in its `runners.yaml`. The
 *   non-application images (b0, MCUboot, provisioning, UICR) are merged into
 *   one bootloader hex, like Zephyr's `merged_<board>.hex`, which only exists
 *   when SB_CONFIG_MERGED_HEX_FILES is set.
 * - Single-image builds: the hex named in `zephyr/runners.yaml`.
 */

export interface FlashImage {
  /** Shown in the task name. */
  label: string;
  /** Absolute path to the hex file. */
  hexPath: string;
  /**
   * Bootloader images rarely change between builds; preverify them so
   * probe-rs skips programming when the device already matches.
   */
  preverify: boolean;
}

export type FlashPlan =
  | { ok: true; images: FlashImage[] }
  | { ok: false; error: string };

/** Directory under the build dir for hex files generated for flashing. */
export const FLASH_WORK_DIR = "zephyr-tools";

const SYSBUILD_MERGED_HEX = /^merged_.+\.hex$/;

/** `merged_<board_target>.hex` from Zephyr sysbuild (or `merged_CPUNET.hex` from Partition Manager). */
export function isSysbuildMergedHex(fileName: string): boolean {
  return SYSBUILD_MERGED_HEX.test(fileName);
}

/**
 * Which Partition Manager layout a build's `zephyr/.config` uses, if any:
 * sysbuild (SB_CONFIG_PARTITION_MANAGER, merged.hex in the build root) or
 * child images (CONFIG_PARTITION_MANAGER_ENABLED, merged.hex in zephyr/).
 */
export function partitionManagerLayout(dotConfig: string): "sysbuild" | "child-image" | undefined {
  if (/^SB_CONFIG_PARTITION_MANAGER=y\s*$/m.test(dotConfig)) {
    return "sysbuild";
  }
  if (/^CONFIG_PARTITION_MANAGER_ENABLED=y\s*$/m.test(dotConfig)) {
    return "child-image";
  }
  return undefined;
}

/**
 * probe-rs erases whole sectors, so two downloads must not share one. 4 KiB
 * is the flash page size on nRF5x/nRF91.
 */
const FLASH_PAGE_SIZE = 0x1000;

function toPages(ranges: Array<[number, number]>): Array<[number, number]> {
  return ranges.map(([start, end]) => [
    Math.floor(start / FLASH_PAGE_SIZE) * FLASH_PAGE_SIZE,
    Math.ceil(end / FLASH_PAGE_SIZE) * FLASH_PAGE_SIZE,
  ]);
}

export interface SysbuildDomains {
  defaultDomain: string;
  flashOrder: string[];
}

export function parseDomainsYaml(text: string): SysbuildDomains | string {
  const parsed = yaml.parse(text) as { default?: unknown; flash_order?: unknown } | null;
  if (!parsed || typeof parsed.default !== "string") {
    return "domains.yaml has no default domain";
  }
  const order = parsed.flash_order;
  if (!Array.isArray(order) || order.length === 0 || !order.every(name => typeof name === "string")) {
    return "domains.yaml has no flash_order";
  }
  return { defaultDomain: parsed.default, flashOrder: order as string[] };
}

/** `config.hex_file` from a runners.yaml. */
export function runnersYamlHexFile(text: string): string | undefined {
  const parsed = yaml.parse(text) as { config?: { hex_file?: unknown } } | null;
  const hexFile = parsed?.config?.hex_file;
  return typeof hexFile === "string" && hexFile !== "" ? hexFile : undefined;
}

export interface SysbuildImage {
  name: string;
  hexPath: string;
  hexText: string;
}

export type SysbuildFlashSplit =
  | { ok: true; bootloaders: SysbuildImage[]; bootloaderHex?: string; app: SysbuildImage }
  | { ok: false; error: string };

/**
 * Split sysbuild images (in flash order) into one merged bootloader hex and
 * the application image. Fails if they share a flash page, since flashing
 * them as two downloads would then erase or overwrite each other.
 */
export function splitSysbuildImages(defaultDomain: string, images: SysbuildImage[]): SysbuildFlashSplit {
  const app = images.find(image => image.name === defaultDomain);
  if (!app) {
    return { ok: false, error: `The default image "${defaultDomain}" is not in domains.yaml flash_order.` };
  }
  const bootloaders = images.filter(image => image !== app);
  if (bootloaders.length === 0) {
    return { ok: true, bootloaders, app };
  }
  const bootloaderHex = mergeHexTexts(bootloaders.map(image => image.hexText));
  if (rangesOverlap(toPages(hexRanges(bootloaderHex)), toPages(hexRanges(app.hexText)))) {
    return {
      ok: false,
      error: `Images ${bootloaders.map(image => image.name).join(", ")} share flash pages with the application image "${app.name}".`,
    };
  }
  return { ok: true, bootloaders, bootloaderHex, app };
}

async function hexFromRunnersYaml(zephyrDir: string, imageName: string): Promise<string | { error: string }> {
  const runnersPath = path.join(zephyrDir, "runners.yaml");
  if (!(await fs.pathExists(runnersPath))) {
    return { error: `Image "${imageName}" has no ${runnersPath}. Build project before flashing.` };
  }
  const hexFile = runnersYamlHexFile(await fs.readFile(runnersPath, "utf8"));
  if (!hexFile) {
    return { error: `${runnersPath} has no hex_file.` };
  }
  const hexPath = path.isAbsolute(hexFile) ? hexFile : path.join(zephyrDir, hexFile);
  if (!(await fs.pathExists(hexPath))) {
    return { error: `Hex for image "${imageName}" not found at ${hexPath}. Build project before flashing.` };
  }
  return hexPath;
}

async function resolvePartitionManager(buildDir: string, layout: "sysbuild" | "child-image"): Promise<FlashPlan> {
  const hexPath = layout === "sysbuild" ? path.join(buildDir, "merged.hex") : path.join(buildDir, "zephyr", "merged.hex");
  if (!(await fs.pathExists(hexPath))) {
    return { ok: false, error: `Partition Manager build has no ${hexPath}. Build project before flashing.` };
  }
  return { ok: true, images: [{ label: "merged.hex", hexPath, preverify: false }] };
}

async function resolveSysbuild(buildDir: string): Promise<FlashPlan> {
  const domains = parseDomainsYaml(await fs.readFile(path.join(buildDir, "domains.yaml"), "utf8"));
  if (typeof domains === "string") {
    return { ok: false, error: `${path.join(buildDir, "domains.yaml")}: ${domains}` };
  }

  const images: SysbuildImage[] = [];
  for (const name of domains.flashOrder) {
    const hexPath = await hexFromRunnersYaml(path.join(buildDir, name, "zephyr"), name);
    if (typeof hexPath !== "string") {
      return { ok: false, error: hexPath.error };
    }
    images.push({ name, hexPath, hexText: await fs.readFile(hexPath, "utf8") });
  }

  const split = splitSysbuildImages(domains.defaultDomain, images);
  if (!split.ok) {
    return split;
  }

  const plan: FlashImage[] = [];
  if (split.bootloaderHex !== undefined) {
    const bootloaderPath = path.join(buildDir, FLASH_WORK_DIR, "bootloaders.hex");
    await fs.outputFile(bootloaderPath, split.bootloaderHex);
    plan.push({
      label: `bootloaders (${split.bootloaders.map(image => image.name).join(", ")})`,
      hexPath: bootloaderPath,
      preverify: true,
    });
  }
  plan.push({ label: split.app.name, hexPath: split.app.hexPath, preverify: false });
  return { ok: true, images: plan };
}

export async function resolveFlashImages(buildDir: string): Promise<FlashPlan> {
  const dotConfigPath = path.join(buildDir, "zephyr", ".config");
  if (!(await fs.pathExists(dotConfigPath))) {
    return { ok: false, error: `No build output found in ${buildDir}. Build project before flashing.` };
  }
  const pmLayout = partitionManagerLayout(await fs.readFile(dotConfigPath, "utf8"));
  if (pmLayout) {
    return resolvePartitionManager(buildDir, pmLayout);
  }
  if (await fs.pathExists(path.join(buildDir, "domains.yaml"))) {
    return resolveSysbuild(buildDir);
  }
  const zephyrDir = path.join(buildDir, "zephyr");
  if (await fs.pathExists(path.join(zephyrDir, "runners.yaml"))) {
    const hexPath = await hexFromRunnersYaml(zephyrDir, "zephyr");
    if (typeof hexPath !== "string") {
      return { ok: false, error: hexPath.error };
    }
    return { ok: true, images: [{ label: path.basename(hexPath), hexPath, preverify: false }] };
  }
  return { ok: false, error: `No build output found in ${buildDir}. Build project before flashing.` };
}

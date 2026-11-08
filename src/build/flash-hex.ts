/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "yaml";

/**
 * Resolve what probe-rs should program for a build.
 *
 * - Partition Manager builds (NCS <= 3.4): `merged.hex` holds every image, in
 *   `zephyr/` (child images) or the build root (sysbuild). Detected from the
 *   build's current `zephyr/.config`, not from files on disk, since an SDK
 *   upgrade without a pristine build leaves the old `partitions.yml` and
 *   `merged.hex` behind.
 * - Sysbuild without Partition Manager (NCS 3.5+, vanilla Zephyr): the SDK's
 *   `merged_<board_target>.hex`, one per board target in `domains.yaml`
 *   `flash_order`, generated when the board or project sets
 *   SB_CONFIG_MERGED_HEX_FILES=y. Every image goes down in one probe-rs
 *   download per board target, so the chip is never reset between images with
 *   only some of them written.
 * - Single-image builds: the hex named in `zephyr/runners.yaml`.
 */

export interface FlashImage {
  /** Shown in the task name. */
  label: string;
  /** Absolute path to the hex file. */
  hexPath: string;
}

export type FlashPlan =
  | { ok: true; images: FlashImage[] }
  | { ok: false; error: string };

/** Directory under the build dir for hex files generated for flashing. */
export const FLASH_WORK_DIR = "zephyr-tools";

/** Sysbuild Kconfig symbol that makes the SDK write `merged_<board_target>.hex`. */
const MERGED_HEX_FILES_SYMBOL = "SB_CONFIG_MERGED_HEX_FILES";

const SYSBUILD_MERGED_HEX = /^merged_.+\.hex$/;

/** `merged_<board_target>.hex` from Zephyr sysbuild (or `merged_CPUNET.hex` from Partition Manager). */
export function isSysbuildMergedHex(fileName: string): boolean {
  return SYSBUILD_MERGED_HEX.test(fileName);
}

/**
 * The `merged_<board_target>.hex` name sysbuild uses for a CONFIG_BOARD_TARGET
 * (see zephyr/share/sysbuild/cmake/modules/sysbuild_merged_hex.cmake).
 */
export function mergedHexFileName(boardTarget: string): string {
  return `merged_${boardTarget.replace(/[/.@]/g, "_")}.hex`;
}

/** CONFIG_BOARD_TARGET from an image's `zephyr/.config`. */
export function dotConfigBoardTarget(dotConfig: string): string | undefined {
  const match = /^CONFIG_BOARD_TARGET="([^"]+)"\s*$/m.exec(dotConfig);
  return match?.[1];
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

/** `flash_order` from a sysbuild `domains.yaml`. */
export function parseDomainsFlashOrder(text: string): string[] | string {
  const parsed = yaml.parse(text) as { flash_order?: unknown } | null;
  const order = parsed?.flash_order;
  if (!Array.isArray(order) || order.length === 0 || !order.every(name => typeof name === "string")) {
    return "domains.yaml has no flash_order";
  }
  return order as string[];
}

/** `config.hex_file` from a runners.yaml. */
export function runnersYamlHexFile(text: string): string | undefined {
  const parsed = yaml.parse(text) as { config?: { hex_file?: unknown } } | null;
  const hexFile = parsed?.config?.hex_file;
  return typeof hexFile === "string" && hexFile !== "" ? hexFile : undefined;
}

async function hexFromRunnersYaml(zephyrDir: string): Promise<string | { error: string }> {
  const runnersPath = path.join(zephyrDir, "runners.yaml");
  const hexFile = runnersYamlHexFile(await fs.readFile(runnersPath, "utf8"));
  if (!hexFile) {
    return { error: `${runnersPath} has no hex_file.` };
  }
  const hexPath = path.isAbsolute(hexFile) ? hexFile : path.join(zephyrDir, hexFile);
  if (!(await fs.pathExists(hexPath))) {
    return { error: `${hexPath} not found. Build project before flashing.` };
  }
  return hexPath;
}

async function resolvePartitionManager(buildDir: string, layout: "sysbuild" | "child-image"): Promise<FlashPlan> {
  const hexPath = layout === "sysbuild" ? path.join(buildDir, "merged.hex") : path.join(buildDir, "zephyr", "merged.hex");
  if (!(await fs.pathExists(hexPath))) {
    return { ok: false, error: `Partition Manager build has no ${hexPath}. Build project before flashing.` };
  }
  return { ok: true, images: [{ label: "merged.hex", hexPath }] };
}

async function resolveSysbuild(buildDir: string): Promise<FlashPlan> {
  const domainsPath = path.join(buildDir, "domains.yaml");
  const flashOrder = parseDomainsFlashOrder(await fs.readFile(domainsPath, "utf8"));
  if (typeof flashOrder === "string") {
    return { ok: false, error: `${domainsPath}: ${flashOrder}` };
  }

  // One merged hex per board target, in the order the targets first appear.
  const fileNames: string[] = [];
  for (const image of flashOrder) {
    const dotConfigPath = path.join(buildDir, image, "zephyr", ".config");
    if (!(await fs.pathExists(dotConfigPath))) {
      return { ok: false, error: `Image "${image}" has no ${dotConfigPath}. Build project before flashing.` };
    }
    const boardTarget = dotConfigBoardTarget(await fs.readFile(dotConfigPath, "utf8"));
    if (!boardTarget) {
      return { ok: false, error: `${dotConfigPath} has no CONFIG_BOARD_TARGET.` };
    }
    const fileName = mergedHexFileName(boardTarget);
    if (!fileNames.includes(fileName)) {
      fileNames.push(fileName);
    }
  }

  const images: FlashImage[] = [];
  for (const fileName of fileNames) {
    const hexPath = path.join(buildDir, fileName);
    if (!(await fs.pathExists(hexPath))) {
      return {
        ok: false,
        error: `${hexPath} not found. Set ${MERGED_HEX_FILES_SYMBOL}=y in the project's sysbuild.conf (or the board's Kconfig.sysbuild) and rebuild.`,
      };
    }
    images.push({ label: fileName, hexPath });
  }
  return { ok: true, images };
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
    const hexPath = await hexFromRunnersYaml(zephyrDir);
    if (typeof hexPath !== "string") {
      return { ok: false, error: hexPath.error };
    }
    return { ok: true, images: [{ label: path.basename(hexPath), hexPath }] };
  }
  return { ok: false, error: `No build output found in ${buildDir}. Build project before flashing.` };
}

import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  dotConfigBoardTarget,
  mergedHexFileName,
  parseDomainsFlashOrder,
  partitionManagerLayout,
  resolveFlashImages,
  runnersYamlHexFile,
} from "../../build/flash-hex";

const BOOT_HEX = [":020000040000FA", ":0400000001020304F2", ":00000001FF"].join("\n");
const APP_HEX = [":020000040002F8", ":0400000005060708E6", ":00000001FF"].join("\n");

async function writeDotConfig(buildDir: string, text: string): Promise<void> {
  await fs.outputFile(path.join(buildDir, "zephyr", ".config"), text);
}

async function writeImageConfig(buildDir: string, name: string, boardTarget: string): Promise<void> {
  await fs.outputFile(path.join(buildDir, name, "zephyr", ".config"), `CONFIG_BOARD_TARGET="${boardTarget}"\n`);
}

suite("flash-hex", () => {
  let tmp: string;

  setup(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-tools-flash-"));
  });

  teardown(async () => {
    await fs.remove(tmp);
  });

  test("parseDomainsFlashOrder reads flash_order", () => {
    assert.deepStrictEqual(parseDomainsFlashOrder("default: app\nflash_order:\n  - mcuboot\n  - app\n"), ["mcuboot", "app"]);
    assert.strictEqual(typeof parseDomainsFlashOrder("default: app\n"), "string");
  });

  test("mergedHexFileName normalizes the board target like sysbuild", () => {
    assert.strictEqual(
      mergedHexFileName("circuitdojo_feather_nrf9151@3/nrf9151/ns"),
      "merged_circuitdojo_feather_nrf9151_3_nrf9151_ns.hex"
    );
    assert.strictEqual(mergedHexFileName("board@1.2.0/soc"), "merged_board_1_2_0_soc.hex");
  });

  test("dotConfigBoardTarget reads CONFIG_BOARD_TARGET", () => {
    assert.strictEqual(dotConfigBoardTarget('CONFIG_BOARD="b"\nCONFIG_BOARD_TARGET="b/soc/ns"\n'), "b/soc/ns");
    assert.strictEqual(dotConfigBoardTarget('CONFIG_BOARD="b"\n'), undefined);
  });


  test("runnersYamlHexFile reads config.hex_file", () => {
    assert.strictEqual(runnersYamlHexFile("config:\n  hex_file: zephyr.signed.hex\n"), "zephyr.signed.hex");
    assert.strictEqual(runnersYamlHexFile("config:\n  elf_file: zephyr.elf\n"), undefined);
  });

  test("partitionManagerLayout reads sysbuild and child-image configs", () => {
    assert.strictEqual(partitionManagerLayout("SB_CONFIG_PARTITION_MANAGER=y\r\n"), "sysbuild");
    assert.strictEqual(partitionManagerLayout("CONFIG_PARTITION_MANAGER_ENABLED=y\n"), "child-image");
    assert.strictEqual(
      partitionManagerLayout("# SB_CONFIG_PARTITION_MANAGER is not set\nSB_CONFIG_MERGED_HEX_FILES=y\n"),
      undefined
    );
  });

  test("Partition Manager build flashes merged.hex, ignoring merged_CPUNET.hex", async () => {
    await writeDotConfig(tmp, "SB_CONFIG_PARTITION_MANAGER=y\n");
    await fs.outputFile(path.join(tmp, "partitions.yml"), "");
    await fs.outputFile(path.join(tmp, "domains.yaml"), "default: app\nflash_order: [app]\n");
    await fs.outputFile(path.join(tmp, "merged.hex"), APP_HEX);
    await fs.outputFile(path.join(tmp, "merged_CPUNET.hex"), BOOT_HEX);
    const plan = await resolveFlashImages(tmp);
    assert.deepStrictEqual(plan, {
      ok: true,
      images: [{ label: "merged.hex", hexPath: path.join(tmp, "merged.hex") }],
    });
  });

  test("child-image Partition Manager build flashes zephyr/merged.hex", async () => {
    await writeDotConfig(tmp, "CONFIG_PARTITION_MANAGER_ENABLED=y\n");
    await fs.outputFile(path.join(tmp, "partitions.yml"), "");
    await fs.outputFile(path.join(tmp, "zephyr", "merged.hex"), APP_HEX);
    const plan = await resolveFlashImages(tmp);
    assert.ok(plan.ok);
    assert.strictEqual(plan.images[0].hexPath, path.join(tmp, "zephyr", "merged.hex"));
  });

  test("sysbuild Partition Manager build ignores a leftover zephyr/merged.hex", async () => {
    await writeDotConfig(tmp, "SB_CONFIG_PARTITION_MANAGER=y\n");
    await fs.outputFile(path.join(tmp, "merged.hex"), APP_HEX);
    await fs.outputFile(path.join(tmp, "zephyr", "merged.hex"), BOOT_HEX);
    const plan = await resolveFlashImages(tmp);
    assert.ok(plan.ok);
    assert.strictEqual(plan.images[0].hexPath, path.join(tmp, "merged.hex"));

    await fs.remove(path.join(tmp, "merged.hex"));
    assert.strictEqual((await resolveFlashImages(tmp)).ok, false);
  });

  test("sysbuild build flashes the SDK merged hex, one per board target", async () => {
    await writeDotConfig(tmp, "SB_CONFIG_MERGED_HEX_FILES=y\n");
    await fs.outputFile(
      path.join(tmp, "domains.yaml"),
      "default: app\nflash_order:\n  - app\n  - uicr\n  - net\n"
    );
    await writeImageConfig(tmp, "app", "feather@3/nrf9151/ns");
    await writeImageConfig(tmp, "uicr", "feather@3/nrf9151/ns");
    await writeImageConfig(tmp, "net", "feather@3/cpunet");
    await fs.outputFile(path.join(tmp, "merged_feather_3_nrf9151_ns.hex"), APP_HEX);
    await fs.outputFile(path.join(tmp, "merged_feather_3_cpunet.hex"), BOOT_HEX);
    // Leftovers from a Partition Manager build before an SDK upgrade without a
    // pristine build must be ignored: the current config has no PM.
    await fs.outputFile(path.join(tmp, "partitions.yml"), "");
    await fs.outputFile(path.join(tmp, "merged.hex"), BOOT_HEX);

    const plan = await resolveFlashImages(tmp);
    assert.ok(plan.ok, plan.ok ? "" : plan.error);
    assert.deepStrictEqual(plan.images, [
      { label: "merged_feather_3_nrf9151_ns.hex", hexPath: path.join(tmp, "merged_feather_3_nrf9151_ns.hex") },
      { label: "merged_feather_3_cpunet.hex", hexPath: path.join(tmp, "merged_feather_3_cpunet.hex") },
    ]);
  });

  test("sysbuild build without the merged hex is an error", async () => {
    await writeDotConfig(tmp, "");
    await fs.outputFile(path.join(tmp, "domains.yaml"), "default: app\nflash_order: [app]\n");
    await writeImageConfig(tmp, "app", "feather/nrf9151/ns");
    await fs.outputFile(path.join(tmp, "app", "zephyr", "zephyr.hex"), APP_HEX);
    const plan = await resolveFlashImages(tmp);
    assert.strictEqual(plan.ok, false);
    assert.ok(!plan.ok && plan.error.includes("SB_CONFIG_MERGED_HEX_FILES"));
  });

  test("single-image build flashes the runners.yaml hex", async () => {
    await writeDotConfig(tmp, "CONFIG_BOARD_TARGET=\"x\"\n");
    await fs.outputFile(path.join(tmp, "zephyr", "zephyr.hex"), APP_HEX);
    await fs.outputFile(path.join(tmp, "zephyr", "runners.yaml"), "config:\n  hex_file: zephyr.hex\n");
    const plan = await resolveFlashImages(tmp);
    assert.ok(plan.ok);
    assert.deepStrictEqual(plan.images.map(image => image.hexPath), [path.join(tmp, "zephyr", "zephyr.hex")]);
  });

  test("empty build directory is an error", async () => {
    assert.strictEqual((await resolveFlashImages(tmp)).ok, false);
  });
});

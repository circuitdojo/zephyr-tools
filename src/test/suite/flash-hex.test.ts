import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  parseDomainsYaml,
  resolveFlashImages,
  runnersYamlHexFile,
  splitSysbuildImages,
  partitionManagerLayout,
} from "../../build/flash-hex";

const BOOT_HEX = [":020000040000FA", ":0400000001020304F2", ":00000001FF"].join("\n");
const APP_HEX = [":020000040002F8", ":0400000005060708E6", ":00000001FF"].join("\n");
const PROVISION_HEX = [":0200000400FFFB", ":04813000AABBCCDD3D", ":00000001FF"].join("\n");

async function writeDotConfig(buildDir: string, text: string): Promise<void> {
  await fs.outputFile(path.join(buildDir, "zephyr", ".config"), text);
}

async function writeImage(buildDir: string, name: string, hexName: string, hexText: string): Promise<void> {
  const zephyrDir = path.join(buildDir, name, "zephyr");
  await fs.outputFile(path.join(zephyrDir, hexName), hexText);
  await fs.outputFile(path.join(zephyrDir, "runners.yaml"), `config:\n  hex_file: ${hexName}\n`);
}

suite("flash-hex", () => {
  let tmp: string;

  setup(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-tools-flash-"));
  });

  teardown(async () => {
    await fs.remove(tmp);
  });

  test("parseDomainsYaml reads default and flash_order", () => {
    const parsed = parseDomainsYaml("default: app\nflash_order:\n  - mcuboot\n  - app\n");
    assert.deepStrictEqual(parsed, { defaultDomain: "app", flashOrder: ["mcuboot", "app"] });
    assert.strictEqual(typeof parseDomainsYaml("default: app\n"), "string");
  });

  test("runnersYamlHexFile reads config.hex_file", () => {
    assert.strictEqual(runnersYamlHexFile("config:\n  hex_file: zephyr.signed.hex\n"), "zephyr.signed.hex");
    assert.strictEqual(runnersYamlHexFile("config:\n  elf_file: zephyr.elf\n"), undefined);
  });

  test("splitSysbuildImages merges non-app images and rejects overlap", () => {
    const boot = { name: "b0", hexPath: "b0.hex", hexText: BOOT_HEX };
    const app = { name: "app", hexPath: "app.hex", hexText: APP_HEX };
    const split = splitSysbuildImages("app", [boot, app]);
    assert.ok(split.ok);
    assert.strictEqual(split.app, app);
    assert.ok(split.bootloaderHex?.includes(":0400000001020304F2"));

    const overlapping = { name: "mcuboot", hexPath: "m.hex", hexText: APP_HEX };
    assert.strictEqual(splitSysbuildImages("app", [overlapping, app]).ok, false);

    // Different bytes in the same 4 KiB page as the app still conflict.
    const samePage = { name: "mcuboot", hexPath: "m.hex", hexText: [":020000040002F8", ":04010000AABBCCDDED", ":00000001FF"].join("\n") };
    assert.strictEqual(splitSysbuildImages("app", [samePage, app]).ok, false);
    assert.strictEqual(splitSysbuildImages("missing", [boot]).ok, false);
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
      images: [{ label: "merged.hex", hexPath: path.join(tmp, "merged.hex"), preverify: false }],
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

  test("sysbuild without merged hex files flashes bootloaders then app from domains.yaml", async () => {
    await fs.outputFile(
      path.join(tmp, "domains.yaml"),
      "default: app\nflash_order:\n  - b0\n  - app\n  - app_provision\n"
    );
    await writeImage(tmp, "b0", "zephyr.hex", BOOT_HEX);
    await writeImage(tmp, "app", "zephyr.signed.hex", APP_HEX);
    // Absolute hex_file, like app_provision in NCS 3.5.
    const provisionHex = path.join(tmp, "app_provision.hex");
    await fs.outputFile(provisionHex, PROVISION_HEX);
    await fs.outputFile(path.join(tmp, "app_provision", "zephyr", "runners.yaml"), `config:\n  hex_file: ${provisionHex}\n`);
    // Leftovers from a Partition Manager build before an SDK upgrade without a
    // pristine build must be ignored: the current config has no PM.
    await writeDotConfig(tmp, "SB_CONFIG_MERGED_HEX_FILES=y\n");
    await fs.outputFile(path.join(tmp, "partitions.yml"), "");
    await fs.outputFile(path.join(tmp, "merged.hex"), BOOT_HEX);

    const plan = await resolveFlashImages(tmp);
    assert.ok(plan.ok, plan.ok ? "" : plan.error);
    assert.deepStrictEqual(plan.images.map(image => [image.label, image.preverify]), [
      ["bootloaders (b0, app_provision)", true],
      ["app", false],
    ]);
    assert.strictEqual(plan.images[1].hexPath, path.join(tmp, "app", "zephyr", "zephyr.signed.hex"));
    const bootloaders = await fs.readFile(plan.images[0].hexPath, "utf8");
    assert.ok(bootloaders.includes(":0400000001020304F2"));
    assert.ok(bootloaders.includes(":04813000AABBCCDD3D"));
  });

  test("sysbuild image with a missing hex is an error", async () => {
    await writeDotConfig(tmp, "");
    await fs.outputFile(path.join(tmp, "domains.yaml"), "default: app\nflash_order: [app]\n");
    await fs.outputFile(path.join(tmp, "app", "zephyr", "runners.yaml"), "config:\n  hex_file: zephyr.hex\n");
    const plan = await resolveFlashImages(tmp);
    assert.strictEqual(plan.ok, false);
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

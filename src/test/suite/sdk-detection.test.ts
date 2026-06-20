import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as fs from "fs-extra";
import { ManifestValidator } from "../../config";

// These exercise the file/layout detection against real fixture trees in a temp
// dir, covering the SDK 1.0 layout change (gnu/) and the parsing the SDK gate
// depends on. No network or real SDK required.
suite("SDK detection (fixtures)", () => {
  let tmp: string;

  setup(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zt-sdk-"));
  });

  teardown(async () => {
    await fs.remove(tmp);
  });

  // Writes a minimal installed-SDK tree and returns its path.
  async function writeSdk(
    name: string,
    version: string,
    layout: "gnu" | "root" | "none",
    minimumCompatible?: string
  ): Promise<string> {
    const sdk = path.join(tmp, name);
    await fs.mkdirp(sdk);
    await fs.writeFile(path.join(sdk, "sdk_version"), `${version}\n`);
    if (layout === "gnu") {
      await fs.mkdirp(path.join(sdk, "gnu", "arm-zephyr-eabi", "bin"));
    } else if (layout === "root") {
      await fs.mkdirp(path.join(sdk, "arm-zephyr-eabi", "bin"));
    }
    if (minimumCompatible) {
      await fs.mkdirp(path.join(sdk, "cmake"));
      await fs.writeFile(
        path.join(sdk, "cmake", "Zephyr-sdkConfigVersion.cmake"),
        `  set(ZEPHYR_SDK_MINIMUM_COMPATIBLE_VERSION ${minimumCompatible})\n`
      );
    }
    return sdk;
  }

  test("getRequiredSdkVersion parses a find_package literal", async () => {
    const zb = path.join(tmp, "zephyr");
    await fs.mkdirp(path.join(zb, "cmake", "modules"));
    await fs.writeFile(
      path.join(zb, "cmake", "modules", "FindHostTools.cmake"),
      "include(...)\nfind_package(Zephyr-sdk 0.16)\n"
    );
    assert.strictEqual(await ManifestValidator.getRequiredSdkVersion(zb), "0.16");
  });

  test("getRequiredSdkVersion returns undefined when the file is missing", async () => {
    assert.strictEqual(
      await ManifestValidator.getRequiredSdkVersion(path.join(tmp, "missing")),
      undefined
    );
  });

  test("getInstalledSdkVersion reads and trims sdk_version", async () => {
    const sdk = await writeSdk("zephyr-sdk-1.0.0", "1.0.0", "gnu");
    assert.strictEqual(await ManifestValidator.getInstalledSdkVersion(sdk), "1.0.0");
  });

  test("getSdkMinimumCompatibleVersion parses the SDK 1.0 config", async () => {
    const sdk = await writeSdk("zephyr-sdk-1.0.0", "1.0.0", "gnu", "1.0");
    assert.strictEqual(await ManifestValidator.getSdkMinimumCompatibleVersion(sdk), "1.0");
  });

  test("sdkToolchainPresent: SDK 1.0 requires the gnu/ layout", async () => {
    // Root layout alone must NOT count as present for a 1.0 SDK.
    const sdk = await writeSdk("zephyr-sdk-1.0.0", "1.0.0", "root");
    assert.strictEqual(await ManifestValidator.sdkToolchainPresent(sdk), false);
    // Adding the gnu/ layout makes it present.
    await fs.mkdirp(path.join(sdk, "gnu", "arm-zephyr-eabi", "bin"));
    assert.strictEqual(await ManifestValidator.sdkToolchainPresent(sdk), true);
  });

  test("sdkToolchainPresent: SDK 0.x uses the root layout", async () => {
    const sdk = await writeSdk("zephyr-sdk-0.16.4", "0.16.4", "root");
    assert.strictEqual(await ManifestValidator.sdkToolchainPresent(sdk), true);
  });

  test("findCompatibleInstalledSdk selects by version AND toolchain presence", async () => {
    await writeSdk("zephyr-sdk-0.16.4", "0.16.4", "root");
    await writeSdk("zephyr-sdk-1.0.0", "1.0.0", "gnu", "1.0");
    const sibling = path.join(tmp, "zephyr-sdk-x"); // dirname() -> tmp

    // A 0.16 tree must get 0.16.4 (1.0 refuses < 1.0).
    assert.strictEqual(
      await ManifestValidator.findCompatibleInstalledSdk("0.16", sibling),
      path.join(tmp, "zephyr-sdk-0.16.4")
    );
    // A 1.0 tree must get 1.0.0.
    assert.strictEqual(
      await ManifestValidator.findCompatibleInstalledSdk("1.0", sibling),
      path.join(tmp, "zephyr-sdk-1.0.0")
    );
  });

  test("findCompatibleInstalledSdk skips a version-match with a missing toolchain", async () => {
    // Right version, but no gnu/ payload -> incomplete -> must not be selected.
    await writeSdk("zephyr-sdk-1.0.0", "1.0.0", "none", "1.0");
    const sibling = path.join(tmp, "zephyr-sdk-x");
    assert.strictEqual(
      await ManifestValidator.findCompatibleInstalledSdk("1.0", sibling),
      undefined
    );
  });
});

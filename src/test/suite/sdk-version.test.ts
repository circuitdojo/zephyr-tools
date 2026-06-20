import * as assert from "assert";
import { ManifestValidator } from "../../config";
import { recommendSdkForRequired, getAvailableSdks } from "../../commands/install-sdk";

// Pure version-compatibility logic. These guard the exact regressions hit while
// adding SDK 1.0 support: the minimum-compatible floor and the >= comparison.
suite("ManifestValidator.sdkVersionSatisfies", () => {
  test("SDK 1.0 refuses a tree requesting < 1.0 (minimum-compatible floor)", () => {
    // installed 1.0.0 is newer, but it declares MINIMUM_COMPATIBLE_VERSION 1.0,
    // so it must NOT serve a 0.16 tree.
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("1.0.0", "0.16", "1.0"), false);
  });

  test("installed must be >= required", () => {
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("0.16.4", "1.0", "0.16"), false);
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("0.16.4", "0.17", undefined), false);
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("0.16.4", "0.16", undefined), true);
  });

  test("exact and patch-level matches are compatible", () => {
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("1.0.0", "1.0", "1.0"), true);
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("0.16.4", "0.16", undefined), true);
  });

  test("no minimum-compatible floor falls back to a plain >= check", () => {
    assert.strictEqual(ManifestValidator.sdkVersionSatisfies("1.0.0", "0.16", undefined), true);
  });
});

// Recommendation maps a tree's required version to a manifest SDK. Only versions
// present on every platform are asserted unconditionally.
suite("recommendSdkForRequired", () => {
  test("recommends the lowest same-major version that satisfies the requirement", () => {
    assert.strictEqual(recommendSdkForRequired("0.16")?.name, "zephyr-sdk-0.16.4");
    assert.strictEqual(recommendSdkForRequired("0.15")?.name, "zephyr-sdk-0.15.1");
    assert.strictEqual(recommendSdkForRequired("0.14")?.name, "zephyr-sdk-0.15.1");
  });

  test("recommends a 1.x SDK for a 1.0 tree where one is available", function () {
    if (!getAvailableSdks().some(sdk => sdk.name.startsWith("zephyr-sdk-1."))) {
      this.skip();
    }
    assert.strictEqual(recommendSdkForRequired("1.0")?.name, "zephyr-sdk-1.0.0");
  });
});

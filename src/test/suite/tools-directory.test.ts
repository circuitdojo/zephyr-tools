import * as assert from "assert";
import * as path from "path";
import { SettingsManager } from "../../config";
import { TOOLS_FOLDER_NAME } from "../../config/constants";

// A space anywhere in the Zephyr SDK install path breaks GNU-toolchain linking on
// Windows (GCC emits its built-in -L paths unquoted, so ld splits at the space).
// These guard the space-free Windows default and the setup-time refusal.
suite("SettingsManager tools directory (Windows space handling)", () => {
  test("Windows home with a space falls back to a space-free root", () => {
    const result = SettingsManager.getDefaultToolsDirectory("C:\\Users\\Jared Wolff", "win32");
    assert.strictEqual(/\s/.test(result), false);
    assert.strictEqual(result, path.win32.join("C:\\", TOOLS_FOLDER_NAME));
  });

  test("Windows home without a space stays under the home directory", () => {
    const result = SettingsManager.getDefaultToolsDirectory("C:\\Users\\jared", "win32");
    assert.strictEqual(result, path.win32.join("C:\\Users\\jared", TOOLS_FOLDER_NAME));
  });

  test("non-Windows keeps the home directory even with a space", () => {
    const result = SettingsManager.getDefaultToolsDirectory("/home/jared wolff", "linux");
    assert.strictEqual(result, path.posix.join("/home/jared wolff", TOOLS_FOLDER_NAME));
  });

  test("validateToolsDirectory rejects a spaced path on Windows", () => {
    const error = SettingsManager.validateToolsDirectory("C:\\Users\\Jared Wolff\\.zephyrtools", "win32");
    assert.ok(error && error.includes("space"));
  });

  test("validateToolsDirectory accepts a space-free path on Windows", () => {
    assert.strictEqual(SettingsManager.validateToolsDirectory("C:\\.zephyrtools", "win32"), undefined);
  });

  test("validateToolsDirectory ignores spaces on non-Windows", () => {
    assert.strictEqual(SettingsManager.validateToolsDirectory("/home/jared wolff/.zephyrtools", "linux"), undefined);
  });
});

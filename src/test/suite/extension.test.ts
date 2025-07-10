import * as assert from "assert";
import * as path from "path";
import * as os from "os";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Sample test", () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });

  test("PATH environment variable handling", () => {
    // Test path divider detection
    const isWindows = os.platform() === "win32";
    const expectedDivider = isWindows ? ";" : ":";

    // Mock system PATH
    const mockSystemPath = isWindows ? "C:\\Windows\\System32;C:\\Windows" : "/usr/bin:/bin";

    // Test path extraction logic
    const testConfigPath = isWindows
      ? "C:\\tools\\python\\Scripts;C:\\tools\\python\\bin;C:\\Windows\\System32;C:\\Windows"
      : "/home/user/.local/bin:/usr/local/bin:/usr/bin:/bin";

    // Extract added paths (simulate the logic from extension.ts)
    const configPath: string = testConfigPath;
    const systemPath: string = mockSystemPath;
    if (configPath !== systemPath && configPath.length > systemPath.length) {
      const pathDividerIndex = configPath.lastIndexOf(systemPath);
      if (pathDividerIndex > 0) {
        const addedPaths = configPath.substring(0, pathDividerIndex);
        const cleanAddedPaths = addedPaths.endsWith(expectedDivider)
          ? addedPaths.substring(0, addedPaths.length - expectedDivider.length)
          : addedPaths;

        const individualPaths = cleanAddedPaths.split(expectedDivider).filter(p => p.trim());

        // Verify we extracted the correct paths
        if (isWindows) {
          assert.strictEqual(individualPaths.length, 2);
          assert.strictEqual(individualPaths[0], "C:\\tools\\python\\Scripts");
          assert.strictEqual(individualPaths[1], "C:\\tools\\python\\bin");
        } else {
          assert.strictEqual(individualPaths.length, 2);
          assert.strictEqual(individualPaths[0], "/home/user/.local/bin");
          assert.strictEqual(individualPaths[1], "/usr/local/bin");
        }
      }
    }
  });

  test("PATH prepend order preservation", () => {
    // Test that when we prepend multiple paths, they maintain correct order
    const paths = ["path1", "path2", "path3"];
    const divider = os.platform() === "win32" ? ";" : ":";

    // When prepending in reverse order (as our code does), the final order should be correct
    const reversedPaths = [...paths].reverse();
    let result = "";

    for (const pathToAdd of reversedPaths) {
      result = pathToAdd + divider + result;
    }

    // Remove trailing divider
    result = result.endsWith(divider) ? result.slice(0, -1) : result;

    assert.strictEqual(result, paths.join(divider));
  });
});

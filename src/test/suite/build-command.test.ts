import * as assert from "assert";
import {
  buildFullCommandArgs,
  configHasAdditionsOrChanges,
  createSnapshot,
  snapshotHasRemovals,
} from "../../commands/build";
import { ProjectConfig } from "../../types";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    isInit: true,
    board: "circuitdojo_feather_nrf9160/nrf9160/ns",
    target: "/work/app",
    ...overrides,
  };
}

suite("buildFullCommandArgs", () => {
  test("minimal build produces board and build dir args", () => {
    const args = buildFullCommandArgs(makeProject(), "build/circuitdojo_feather_nrf9160", false);
    assert.deepStrictEqual(args, [
      "build",
      "-b",
      "circuitdojo_feather_nrf9160/nrf9160/ns",
      "-d",
      "build/circuitdojo_feather_nrf9160",
    ]);
  });

  test("pristine adds -p and sysbuild adds --sysbuild", () => {
    const args = buildFullCommandArgs(makeProject({ sysbuild: true }), "build/b", true);
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("--sysbuild"));
  });

  test("extra conf and overlay files are joined with semicolons after --", () => {
    const args = buildFullCommandArgs(
      makeProject({
        extraConfFiles: ["a.conf", "b.conf"],
        extraOverlayFiles: ["x.overlay"],
      }),
      "build/b",
      false
    );
    const sepIndex = args.indexOf("--");
    assert.ok(sepIndex !== -1);
    assert.ok(args.includes("-DEXTRA_CONF_FILE=a.conf;b.conf"));
    assert.ok(args.includes("-DDTC_OVERLAY_FILE=x.overlay"));
    assert.ok(args.indexOf("-DEXTRA_CONF_FILE=a.conf;b.conf") > sepIndex);
  });

  test("custom CMake defines are passed through verbatim as single args", () => {
    const args = buildFullCommandArgs(
      makeProject({ extraCMakeDefines: ['MY_FLAG="quoted value"'] }),
      "build/b",
      false
    );
    assert.ok(args.includes('-DMY_FLAG="quoted value"'));
  });

  test("no -- separator when there are no extra args", () => {
    const args = buildFullCommandArgs(makeProject(), "build/b", false);
    assert.strictEqual(args.includes("--"), false);
  });
});

suite("configHasAdditionsOrChanges", () => {
  test("returns false when config matches the CMake cache", () => {
    const project = makeProject({ extraConfFiles: ["a.conf"] });
    const cache = new Map([
      ["BOARD", project.board!],
      ["EXTRA_CONF_FILE", "a.conf"],
    ]);
    assert.strictEqual(configHasAdditionsOrChanges(project, cache), false);
  });

  test("detects a board change", () => {
    const cache = new Map([["BOARD", "some_other_board"]]);
    assert.strictEqual(configHasAdditionsOrChanges(makeProject(), cache), true);
  });

  test("detects an added conf file", () => {
    const project = makeProject({ extraConfFiles: ["a.conf", "new.conf"] });
    const cache = new Map([
      ["BOARD", project.board!],
      ["EXTRA_CONF_FILE", "a.conf"],
    ]);
    assert.strictEqual(configHasAdditionsOrChanges(project, cache), true);
  });

  test("finds CMake defines stored under the CLI_ prefix", () => {
    const project = makeProject({ extraCMakeDefines: ["FOO=bar"] });
    const cache = new Map([
      ["BOARD", project.board!],
      ["CLI_FOO", "bar"],
    ]);
    assert.strictEqual(configHasAdditionsOrChanges(project, cache), false);
  });
});

suite("snapshotHasRemovals", () => {
  test("returns false when nothing was removed", () => {
    const current = createSnapshot(makeProject({ extraConfFiles: ["a.conf"] }));
    const previous = createSnapshot(makeProject({ extraConfFiles: ["a.conf"] }));
    assert.strictEqual(snapshotHasRemovals(current, previous), false);
  });

  test("detects a removed conf file", () => {
    const current = createSnapshot(makeProject({ extraConfFiles: [] }));
    const previous = createSnapshot(makeProject({ extraConfFiles: ["a.conf"] }));
    assert.strictEqual(snapshotHasRemovals(current, previous), true);
  });

  test("detects a replaced overlay file (same count, different name)", () => {
    const current = createSnapshot(makeProject({ extraOverlayFiles: ["b.overlay"] }));
    const previous = createSnapshot(makeProject({ extraOverlayFiles: ["a.overlay"] }));
    assert.strictEqual(snapshotHasRemovals(current, previous), true);
  });

  test("detects a removed CMake define by key", () => {
    const current = createSnapshot(makeProject({ extraCMakeDefines: ["KEEP=1"] }));
    const previous = createSnapshot(makeProject({ extraCMakeDefines: ["KEEP=1", "DROP=1"] }));
    assert.strictEqual(snapshotHasRemovals(current, previous), true);
  });

  test("a define value change alone is not a removal", () => {
    const current = createSnapshot(makeProject({ extraCMakeDefines: ["FOO=2"] }));
    const previous = createSnapshot(makeProject({ extraCMakeDefines: ["FOO=1"] }));
    assert.strictEqual(snapshotHasRemovals(current, previous), false);
  });
});

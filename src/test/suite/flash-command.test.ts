import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { recoveryProbeArgs } from "../../commands/flash";

suite("recoveryProbeArgs", () => {
  test("VID:PID:serial becomes decimal ids plus serial", () => {
    assert.deepStrictEqual(recoveryProbeArgs("2e8a:000c:E664B012CF809B28"), [
      "--vendor-id", "11914", "--product-id", "12", "--serial", "E664B012CF809B28",
    ]);
  });

  test("VID:PID without serial omits --serial", () => {
    assert.deepStrictEqual(recoveryProbeArgs("1366:1015"), ["--vendor-id", "4966", "--product-id", "4117"]);
  });

  test("a bare serial is passed as the serial only", () => {
    assert.deepStrictEqual(recoveryProbeArgs("ABCXYZ"), ["--serial", "ABCXYZ"]);
  });

  test("no probe id adds nothing", () => {
    assert.deepStrictEqual(recoveryProbeArgs(undefined), []);
  });
});

suite("ProcessExecution tasks", () => {
  test("resolve the command from the task env PATH and pass arguments verbatim", async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    this.timeout(20000);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-tools-exec-"));
    try {
      const binDir = path.join(tmp, "bin dir");
      const outFile = path.join(tmp, "args.txt");
      const script = path.join(binDir, "zt-echo-args");
      await fs.outputFile(script, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "$ZT_OUT"\n`);
      await fs.chmod(script, 0o755);

      const args = ["-DEXTRA_CONF_FILE=cmux.conf;ppp.conf", "it's", "$HOME", "a b"];
      const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`, ZT_OUT: outFile } as {
        [key: string]: string;
      };
      const task = new vscode.Task(
        { type: "zephyr-tools", command: "test-echo-args" },
        vscode.TaskScope.Workspace,
        "test-echo-args",
        "zephyr-tools",
        new vscode.ProcessExecution("zt-echo-args", args, { env, cwd: tmp })
      );

      const execution = await vscode.tasks.executeTask(task);
      const exitCode = await new Promise<number | undefined>(resolve => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
          if (e.execution === execution) {
            disposable.dispose();
            resolve(e.exitCode);
          }
        });
      });

      assert.strictEqual(exitCode, 0);
      assert.deepStrictEqual((await fs.readFile(outFile, "utf8")).trimEnd().split("\n"), args);
    } finally {
      await fs.remove(tmp);
    }
  });
});

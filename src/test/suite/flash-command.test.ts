import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { recoveryProbeArgs } from "../../commands/flash";
import { createProcessExecution, createShellCommandExecution, executeTaskAndWait } from "../../tasks";

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

suite("createProcessExecution", () => {
  let tmp: string;
  let binDir: string;
  let env: { [key: string]: string };

  setup(async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-tools-exec-"));
    binDir = path.join(tmp, "bin dir");
    env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`, ZT_OUT: path.join(tmp, "args.txt") } as {
      [key: string]: string;
    };
  });

  teardown(async () => {
    if (tmp) {
      await fs.remove(tmp);
    }
  });

  async function runCommandLine(name: string, commandLine: string): Promise<number | undefined> {
    const task = new vscode.Task(
      { type: "zephyr-tools", command: name },
      vscode.TaskScope.Workspace,
      name,
      "zephyr-tools",
      createShellCommandExecution(commandLine, { env, cwd: tmp })
    );
    return executeTaskAndWait(task);
  }

  async function runScript(name: string, body: string, args: string[]): Promise<number | undefined> {
    const script = path.join(binDir, name);
    await fs.outputFile(script, `#!/bin/sh\n${body}\n`);
    await fs.chmod(script, 0o755);
    const task = new vscode.Task(
      { type: "zephyr-tools", command: name },
      vscode.TaskScope.Workspace,
      name,
      "zephyr-tools",
      createProcessExecution(name, args, { env, cwd: tmp })
    );
    return executeTaskAndWait(task);
  }

  test("resolves the command from the task env PATH and passes arguments verbatim", async function () {
    this.timeout(20000);
    const args = ["-DEXTRA_CONF_FILE=cmux.conf;ppp.conf", "it's", "$HOME", "a b", ""];
    const exitCode = await runScript("zt-echo-args", 'for a in "$@"; do printf \'%s|\\n\' "$a"; done > "$ZT_OUT"', args);
    assert.strictEqual(exitCode, 0);
    const lines = (await fs.readFile(path.join(tmp, "args.txt"), "utf8")).trimEnd().split("\n");
    assert.deepStrictEqual(lines, args.map(a => `${a}|`));
  });

  test("passes the command's exit code through", async function () {
    this.timeout(20000);
    assert.strictEqual(await runScript("zt-exit-3", "exit 3", []), 3);
  });

  test("shell command lines keep shell syntax, exit codes and Ctrl-C failures", async function () {
    this.timeout(20000);
    assert.strictEqual(await runCommandLine("zt-line-ok", 'printf %s "a b" > "$ZT_OUT"'), 0);
    assert.strictEqual(await fs.readFile(path.join(tmp, "args.txt"), "utf8"), "a b");
    assert.strictEqual(await runCommandLine("zt-line-exit", "exit 4"), 4);
    assert.strictEqual(await runCommandLine("zt-line-sigint", "sh -c 'kill -INT 0; sleep 5'"), 130);
  });

  test("reports a Ctrl-C (SIGINT to the process group) as a failure", async function () {
    this.timeout(20000);
    // VS Code reports 0 for a process killed by a signal; the wrapper exits 130.
    assert.strictEqual(await runScript("zt-sigint", "kill -INT 0\nsleep 5", []), 130);
  });
});

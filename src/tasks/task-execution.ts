/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

/**
 * Execute a task and call onEnd with its exit code when its process ends.
 *
 * The end listener is registered before the task starts, so a process that
 * exits before executeTask resolves (common with ProcessExecution, which has
 * no shell startup) is not missed. onEnd always runs after this function's
 * promise resolves, so callers can store the returned execution first.
 */
export async function executeTaskWithEndHandler(
  task: vscode.Task,
  onEnd: (exitCode: number | undefined, execution: vscode.TaskExecution) => void
): Promise<vscode.TaskExecution> {
  let execution: vscode.TaskExecution | undefined;
  const earlyEnds: vscode.TaskProcessEndEvent[] = [];
  const disposable = vscode.tasks.onDidEndTaskProcess(e => {
    if (!execution) {
      earlyEnds.push(e);
      return;
    }
    if (e.execution === execution) {
      disposable.dispose();
      onEnd(e.exitCode, execution);
    }
  });

  try {
    execution = await vscode.tasks.executeTask(task);
  } catch (error) {
    disposable.dispose();
    throw error;
  }

  const started = execution;
  const ended = earlyEnds.find(e => e.execution === started);
  if (ended) {
    disposable.dispose();
    setTimeout(() => onEnd(ended.exitCode, started), 0);
  }
  return started;
}

/**
 * Execute a task and resolve with its process exit code once it finishes.
 * Resolves undefined when the exit code cannot be determined.
 */
export function executeTaskAndWait(task: vscode.Task): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    executeTaskWithEndHandler(task, exitCode => resolve(exitCode)).catch(reject);
  });
}

/**
 * Run a command as a task without shell parsing of its arguments.
 *
 * VS Code reports exit code 0 for a task process killed by a signal, so a
 * Ctrl-C'd flash or build would look successful. On POSIX the command runs
 * under `sh`, which traps SIGINT and exits 130 once the command has died;
 * arguments are passed as positional parameters ("$0" "$@"), never parsed.
 * On Windows a Ctrl-C'd process already exits non-zero.
 */
export function createProcessExecution(
  command: string,
  args: string[],
  options?: vscode.ProcessExecutionOptions
): vscode.ProcessExecution {
  if (process.platform === "win32") {
    return new vscode.ProcessExecution(command, args, options);
  }
  return new vscode.ProcessExecution("/bin/sh", ["-c", 'trap "exit 130" INT; "$0" "$@"', command, ...args], options);
}

/**
 * Run a shell command line as a task, for commands that intentionally contain
 * shell syntax (e.g. user-entered runner parameters). On POSIX it runs under
 * `/bin/sh` with the same SIGINT trap as createProcessExecution, so Ctrl-C is
 * reported as a failure; on Windows it uses the default task shell.
 */
export function createShellCommandExecution(
  commandLine: string,
  options?: vscode.ShellExecutionOptions
): vscode.ProcessExecution | vscode.ShellExecution {
  if (process.platform === "win32") {
    return new vscode.ShellExecution(commandLine, options);
  }
  return new vscode.ProcessExecution("/bin/sh", ["-c", `trap "exit 130" INT; ${commandLine}`], {
    cwd: options?.cwd,
    env: options?.env,
  });
}

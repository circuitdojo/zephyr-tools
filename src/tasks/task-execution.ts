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

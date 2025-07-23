/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

type TaskManagerCallback = (data: any) => void;

export interface TaskManagerTaskOptions {
  errorMessage?: string;
  ignoreError: boolean;
  lastTask: boolean;
  successMessage?: string;
  callback?: TaskManagerCallback;
  callbackData?: any;
}

interface TaskManagerTask {
  task: vscode.Task;
  options?: TaskManagerTaskOptions;
}

export class TaskManager {
  private static tasks: TaskManagerTask[] = [];
  private static current: vscode.TaskExecution | undefined = undefined;
  private static currentOptions: TaskManagerTaskOptions | undefined = undefined;
  private static initialized = false;

  static init() {
    if (this.initialized) {
      return;
    }

    vscode.tasks.onDidEndTaskProcess(async e => {
      // Check if matches the current running task
      if (this.current === e.execution) {
        // Check return code
        if (e.exitCode !== 0 && this.currentOptions?.ignoreError === false) {
          if (this.currentOptions?.errorMessage !== undefined) {
            vscode.window.showErrorMessage(`${this.currentOptions.errorMessage}`);
          } else {
            vscode.window.showErrorMessage(`Task ${e.execution.task.name} exited with code ${e.exitCode}`);
          }

          this.cancel();
          return;
        } else {
          // Show success message only for last tasks
          if (this.currentOptions?.lastTask === true && this.currentOptions.successMessage !== undefined) {
            vscode.window.showInformationMessage(`${this.currentOptions.successMessage}`);
          }

          // Call the callback on success for all tasks (not just last ones)
          if (this.currentOptions?.callback !== undefined) {
            this.currentOptions?.callback(this.currentOptions.callbackData);
          }
        }

        // Execute next task
        let next = this.tasks.shift();
        if (next !== undefined) {
          this.currentOptions = next.options;
          this.current = await vscode.tasks.executeTask(next.task);
        } else {
          this.currentOptions = undefined;
          this.current = undefined;
        }
      }
    });

    this.initialized = true;
  }

  static async push(task: vscode.Task, options?: TaskManagerTaskOptions) {
    // If a task is already running, queue it
    if (this.current !== undefined) {
      this.tasks.push({ task, options });
      return;
    }

    // Otherwise, start the execution
    this.current = await vscode.tasks.executeTask(task);
    this.currentOptions = options;
  }

  static async cancel() {
    // Cancel current task
    if (this.current !== undefined) {
      this.current?.terminate();
      this.current = undefined;
      this.currentOptions = undefined;
    }

    // Clear queue
    this.tasks = [];
  }

  static async executeWithProgress(
    task: vscode.Task, 
    options: TaskManagerTaskOptions,
    progressOptions?: vscode.ProgressOptions
  ): Promise<void> {
    if (progressOptions) {
      return vscode.window.withProgress(progressOptions, async (progress, token) => {
        token.onCancellationRequested(() => {
          this.cancel();
        });

        await this.push(task, {
          ...options,
          callback: (data) => {
            progress.report({ increment: 100 });
            options.callback?.(data);
          }
        });
      });
    } else {
      await this.push(task, options);
    }
  }

  static getCurrentTask(): vscode.TaskExecution | undefined {
    return this.current;
  }

  static getQueueLength(): number {
    return this.tasks.length;
  }

  /**
   * Execute a sequence of tasks/commands in order
   */
  static async executeSequence(tasks: (() => Promise<void>)[]): Promise<void> {
    for (const task of tasks) {
      await task();
    }
  }

  /**
   * Execute a task with a dependency
   */
  static async executeWithDependency<T>(
    dependency: () => Promise<T>,
    dependent: (result: T) => Promise<void>
  ): Promise<void> {
    const result = await dependency();
    await dependent(result);
  }
}

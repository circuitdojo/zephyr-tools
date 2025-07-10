/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";

type TaskManagerCallback = (data: any) => void;

type TaskManagerTaskOptions = {
  errorMessage?: string;
  ignoreError: boolean;
  lastTask: boolean;
  successMessage?: string;
  callback?: TaskManagerCallback;
  callbackData?: any;
};

type TaskManagerTask = {
  task: vscode.Task;
  options?: TaskManagerTaskOptions;
};

type TaskManagerExecution = {
  execution: vscode.TaskExecution;
};

export class TaskManager {
  private static tasks: TaskManagerTask[] = [];
  private static current: vscode.TaskExecution | undefined = undefined;
  private static currentOptions: TaskManagerTaskOptions | undefined = undefined;

  public static async push(task: vscode.Task, options?: TaskManagerTaskOptions) {
    // If a task is already running return;
    if (this.current !== undefined) {
      this.tasks.push({ task, options });
      return;
    }

    // Otherwise, start the execution
    this.current = await vscode.tasks.executeTask(task);
    this.currentOptions = options;
  }

  public static async cancel() {
    // Cancel current
    if (this.current !== undefined) {
      this.current?.terminate();
      this.current = undefined;
      this.currentOptions = undefined;
    }

    // TODO: cancel all other running/queued tasks

    // Then clear queue
    this.tasks = [];
  }

  public static init() {
    // TODO: check if the task failed. And notify accordingly. (Init the project..)

    vscode.tasks.onDidEndTaskProcess(async e => {
      // Check if matches the current running task
      if (this.current === e.execution) {
        // Checks return code
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

        // Execute next...
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
  }
}

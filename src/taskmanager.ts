import * as vscode from "vscode";

type TaskManagerTaskOptions = {
    errorMessage?: string,
    ignoreError: boolean,
    lastTask: boolean,
    successMessage?: string,
};

type TaskManagerTask = {
    task: vscode.Task,
    options?: TaskManagerTaskOptions,
};

type TaskManagerExecution = {
    execution: vscode.TaskExecution
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

        vscode.tasks.onDidEndTaskProcess(async (e) => {

            // Check if matches the current running task
            if (this.current === e.execution) {

                // Checks return code
                if (e.exitCode !== 0 && !this.currentOptions?.ignoreError) {

                    if (this.currentOptions?.errorMessage !== undefined) {
                        vscode.window.showErrorMessage(`${this.currentOptions.errorMessage}`);
                    } else {
                        vscode.window.showErrorMessage(`Task ${e.execution.task.name} exited with code ${e.exitCode}`);
                    }

                    this.cancel();
                    return;
                } else if (this.currentOptions?.lastTask === true && this.currentOptions.successMessage !== undefined) {
                    vscode.window.showInformationMessage(`${this.currentOptions.successMessage}`);
                }

                // Execute next...
                let next = this.tasks.pop();
                if (next !== undefined) {
                    this.current = await vscode.tasks.executeTask(next.task);
                    this.currentOptions = next.options;
                } else {
                    this.currentOptions = undefined;
                    this.current = undefined;
                }

            }
        });
    }
}


/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import { GlobalConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { EnvironmentUtils } from "../utils";
import { SettingsManager } from "../config/settings-manager";
import { TaskManager } from "../tasks";
import { OutputChannelManager } from "../ui";
import { getRequirementsInstallCommand } from "../environment";
import { ensureCompatibleSdkInteractive } from "./install-sdk";

const TASK_TYPE = "zephyr-tools";

function getWorkspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Builds a task that (re)installs the Zephyr tree's Python requirements. The
 * underlying command tracks whatever the current tree needs, so it stays correct
 * across Zephyr version changes.
 */
async function buildRequirementsTask(cwd: string, taskName: string): Promise<vscode.Task> {
  const env = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
  const cmd = await getRequirementsInstallCommand(
    SettingsManager.getZephyrBase() ?? "zephyr",
    env,
    cwd
  );

  const exec = new vscode.ShellExecution(cmd, { env, cwd });
  return new vscode.Task(
    { type: TASK_TYPE, command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    TASK_TYPE,
    exec,
  );
}

/**
 * Updates west projects and then refreshes Python requirements, keeping the
 * virtual environment in sync when a Zephyr version bump changes dependencies.
 */
export async function updateCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: { refresh?(): void }
): Promise<void> {
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  const cwd = getWorkspaceCwd();
  if (!cwd) {
    vscode.window.showErrorMessage("No workspace folder found.");
    return;
  }

  const env = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
  const taskName = "Zephyr Tools: Update Dependencies";

  const updateExec = new vscode.ShellExecution("west update", { env, cwd });
  const updateTask = new vscode.Task(
    { type: TASK_TYPE, command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    TASK_TYPE,
    updateExec,
  );

  // After `west update` succeeds, bring the rest of the toolchain in line with the
  // (possibly bumped) Zephyr revision: re-resolve the required SDK — prompting to
  // install/repair it if it's missing or incomplete — then refresh Python deps.
  const refreshDependencies = async () => {
    await ensureCompatibleSdkInteractive(context);

    // The Zephyr tree's required SDK may have changed with the update. Refresh the
    // sidebar so it reflects the new SDK state (active version or "SDK Required"),
    // even when no SDK switch occurred (which wouldn't fire a config-change event).
    sidebarProvider?.refresh?.();

    OutputChannelManager.getChannel().appendLine("[UPDATE] Refreshing Python requirements...");
    const requirementsTask = await buildRequirementsTask(cwd, taskName);
    await TaskManager.push(requirementsTask, {
      ignoreError: false,
      lastTask: true,
      successMessage: "Dependencies updated.",
    });
  };

  try {
    await TaskManager.push(updateTask, {
      ignoreError: false,
      lastTask: false,
      callback: refreshDependencies,
    });
    vscode.window.showInformationMessage("Updating dependencies for project.");
  } catch (error) {
    vscode.window.showErrorMessage(`Update failed: ${error}`);
  }
}

/**
 * Reinstalls the Zephyr tree's Python requirements without running `west update`.
 * Useful when dependencies change but the west projects are already up to date.
 */
export async function installRequirementsCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  const project = await ProjectConfigManager.load(context);
  const projectValidation = ConfigValidator.validateProjectInit(project);
  if (!projectValidation.isValid) {
    vscode.window.showErrorMessage(projectValidation.error!);
    return;
  }

  const cwd = getWorkspaceCwd();
  if (!cwd) {
    vscode.window.showErrorMessage("No workspace folder found.");
    return;
  }

  const taskName = "Zephyr Tools: Install Python Requirements";
  try {
    const requirementsTask = await buildRequirementsTask(cwd, taskName);
    await TaskManager.push(requirementsTask, {
      ignoreError: false,
      lastTask: true,
      successMessage: "Python requirements installed.",
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to install Python requirements: ${error}`);
  }
}

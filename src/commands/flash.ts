/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import * as cp from "child_process";
import * as util from "util";
import { GlobalConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { SerialPortManager, ProbeManager } from "../hardware";
import { monitorCommand } from "./monitor";
import { changeBoardCommand } from "./board-management";
import { changeProjectCommand } from "./project-management";
import { ProjectConfig } from "../types";
import { PlatformUtils, EnvironmentUtils } from "../utils";
import { SettingsManager } from "../config/settings-manager";

const execFile = util.promisify(cp.execFile);

/**
 * Execute a task and resolve with its process exit code once it finishes.
 * Returns undefined when the exit code cannot be determined.
 */
async function executeTaskAndWait(task: vscode.Task): Promise<number | undefined> {
  const execution = await vscode.tasks.executeTask(task);
  return new Promise((resolve) => {
    const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) {
        disposable.dispose();
        resolve(e.exitCode);
      }
    });
  });
}

export async function flashCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: { refresh?(): void }
): Promise<boolean> {
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return false;
  }

  let project = await ProjectConfigManager.load(context);

  // Auto-prompt for board if undefined (replicates old extension behavior)
  if (!project.board) {
    await changeBoardCommand(config, context);
    
    // Reload project config after changeBoardCommand
    project = await ProjectConfigManager.load(context);
    
    // Check again - if still undefined, show error and return
    if (!project.board) {
      vscode.window.showErrorMessage("You must choose a board before flashing.");
      return false;
    }
  }

  // Check if this is a Circuit Dojo board - if so, use probe-rs command instead
  if (project.board.toLowerCase().includes('circuitdojo')) {
    return await flashProbeRsCommand(config, context);
  }

  // Auto-prompt for project target if undefined (replicates old extension behavior)
  if (!project.target) {
    await changeProjectCommand(config, context);

    // Reload project config after changeProjectCommand
    project = await ProjectConfigManager.load(context);

    // Check again - if still undefined, show error and return
    if (!project.target) {
      vscode.window.showErrorMessage("You must choose a project before flashing.");
      return false;
    }
  }

  // Options for Shell Execution with normalized environment
  const options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution()),
    cwd: project.target,
  };

  // Tasks
  const taskName = "Zephyr Tools: Flash";

  // Generate universal build path that works on windows & *nix.
  // Note: this command stays in command-line form because runnerParams is a raw
  // shell fragment (e.g. -O="--probe" -O="1234"); the interpolated pieces here
  // (relative build dir, runner name) contain no spaces or shell metacharacters.
  const buildPath = path.join("build", project.board?.split("/")[0] ?? "");
  let cmd = `west flash -d ${buildPath}`;

  // Add runner if it exists
  if (project.runner) {
    cmd += ` -r ${project.runner}`;
    
    // Handle probe-rs runner with probe selection
    if (project.runner === "probe-rs") {
      await handleProbeRsProbeSelection(project, context, config);
      // Reload project to get updated runnerParams
      project = await ProjectConfigManager.load(context);
    }
    
    // Add runner parameters if they exist
    if (project.runnerParams) {
      cmd += ` ${project.runnerParams}`;
    }
  }

  console.log("flash command: " + cmd);

  const exec = new vscode.ShellExecution(cmd, options);

  // Task
  const task = new vscode.Task(
    { type: "zephyr-tools", command: taskName, isBackground: true },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Flashing for ${project.board}`);

  // Wait for the flash to finish so callers (e.g. flash-and-monitor) don't open
  // the serial port while west flash is still using it.
  const exitCode = await executeTaskAndWait(task);

  // Refresh sidebar after completion (flash may have triggered a build)
  if (sidebarProvider && typeof sidebarProvider.refresh === 'function') {
    sidebarProvider.refresh();
  }

  if (exitCode !== 0) {
    vscode.window.showErrorMessage("Flash failed. See task output for details.");
    return false;
  }
  return true;
}

export async function flashAndMonitorCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: { refresh?(): void }
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  try {
    const project = await ProjectConfigManager.load(context);

    // Check if this is a Circuit Dojo board - if so, use probe-rs version instead
    if (project.board && project.board.toLowerCase().includes('circuitdojo')) {
      return await flashProbeRsAndMonitorCommand(config, context);
    }

    // Step 1: Flash the device (waits for completion; skip monitor on failure)
    if (!(await flashCommand(config, context, sidebarProvider))) {
      return;
    }

    // Step 2: Set up serial port if not configured
    let port = SettingsManager.getSerialPort();
    if (!port) {
      port = await SerialPortManager.selectPort(config);
      if (!port) {
        vscode.window.showErrorMessage("Error obtaining serial port for monitoring.");
        return;
      }

      await SettingsManager.setSerialPort(port);
    }

    // Step 3: Start monitoring
    await monitorCommand(config, context);

  } catch (error) {
    vscode.window.showErrorMessage(`Flash and monitor failed: ${error}`);
  }
}

export async function flashProbeRsAndMonitorCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<void> {
  // Check manifest version and setup state
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return;
  }

  try {
    await ProjectConfigManager.load(context);

    // Step 1: Flash the device with probe-rs (skip monitor on failure)
    if (!(await flashProbeRsCommand(config, context))) {
      return;
    }

    // Step 2: Set up serial port if not configured
    let port = SettingsManager.getSerialPort();
    if (!port) {
      port = await SerialPortManager.selectPort(config);
      if (!port) {
        vscode.window.showErrorMessage("Error obtaining serial port for monitoring.");
        return;
      }
      
      await SettingsManager.setSerialPort(port);
    }

    // Step 3: Start monitoring
    await monitorCommand(config, context);
    
  } catch (error) {
    vscode.window.showErrorMessage(`Flash via probe-rs and monitor failed: ${error}`);
  }
}

export async function flashProbeRsCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext
): Promise<boolean> {
  const validationResult = await ConfigValidator.validateSetupState(config, context, false);
  if (!validationResult.isValid) {
    vscode.window.showErrorMessage(validationResult.error!);
    return false;
  }

  let project = await ProjectConfigManager.load(context);

  // Auto-prompt for project target if undefined (replicates old extension behavior)
  if (!project.target) {
    await changeProjectCommand(config, context);

    // Reload project config after changeProjectCommand
    project = await ProjectConfigManager.load(context);

    // Check again - if still undefined, show error and return
    if (!project.target) {
      vscode.window.showErrorMessage("You must choose a project before flashing.");
      return false;
    }
  }

  // Auto-prompt for board if undefined (replicates old extension behavior)
  if (!project.board) {
    await changeBoardCommand(config, context);

    // Reload project config after changeBoardCommand
    project = await ProjectConfigManager.load(context);

    // Check again - if still undefined, show error and return
    if (!project.board) {
      vscode.window.showErrorMessage("You must choose a board before flashing.");
      return false;
    }
  }

  // Create shell options with normalized environment
  const shellOptions = EnvironmentUtils.createShellOptions(SettingsManager.buildEnvironmentForExecution(), project.target);
  const options: vscode.ShellExecutionOptions = shellOptions;

  const taskName = "Zephyr Tools: Flash with probe-rs";

  // Generate universal build path that works on windows & *nix
  const buildPath = path.join("build", project.board.split("/")[0]);
  const hexFilePathZephyr = path.join(buildPath, "zephyr", "merged.hex");
  const hexFilePathBoard = path.join(buildPath, "merged.hex");
  
  let hexFilePath = "";
  
  // Check if merged.hex exists in zephyr subdirectory first
  if (await fs.pathExists(path.join(project.target!, hexFilePathZephyr))) {
    hexFilePath = hexFilePathZephyr;
  }
  // If not found, check in board directory
  else if (await fs.pathExists(path.join(project.target!, hexFilePathBoard))) {
    hexFilePath = hexFilePathBoard;
  }
  // If not found in either location, show error
  else {
    vscode.window.showErrorMessage(`Hex file not found at paths: ${hexFilePathZephyr} or ${hexFilePathBoard}. Build project before flashing.`);
    return false;
  }

  // Check for available probes and handle settings
  let probeId: string | undefined = SettingsManager.getProbeRsProbeId();
  const availableProbes = await ProbeManager.getAvailableProbes(shellOptions.env);
  if (!availableProbes || availableProbes.length === 0) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return false;
  }

  if (availableProbes.length === 1) {
    // Single probe, use it automatically
    probeId = availableProbes[0].probeId;
    console.log(`Using single available probe: ${probeId}`);
    
    // Save the probe ID to settings for future use
    if (probeId) {
      await SettingsManager.setProbeRsProbeId(probeId);
    }
  } else {
    // Multiple probes - check if we have a saved probe ID that's still available
    if (probeId) {
      const savedProbe = availableProbes.find(p => p.probeId === probeId);
      if (savedProbe) {
        console.log(`Using saved probe: ${probeId}`);
      } else {
        // Saved probe not found, clear it
        probeId = undefined;
      }
    }
    
    // If no saved probe or saved probe not found, let user choose
    if (!probeId) {
      const selectedProbe = await ProbeManager.selectProbe(availableProbes);
      if (!selectedProbe) {
        vscode.window.showErrorMessage("No probe selected for probe-rs flashing.");
        return false;
      }
      probeId = selectedProbe.probeId;

      // Save the selected probe ID
      if (probeId) {
        await SettingsManager.setProbeRsProbeId(probeId);
      }
    }
  }

  // Get chip name from settings or user selection
  let chipName: string | undefined = SettingsManager.getProbeRsChipName();

  // Check if we have a saved chip name
  if (chipName) {
    console.log(`Using saved chip name: ${chipName}`);
  } else {
    // Get available chips from probe-rs
    chipName = await ProbeManager.getProbeRsChipName(shellOptions.env);
    if (!chipName) {
      vscode.window.showErrorMessage("No chip selected for probe-rs flashing.");
      return false;
    }

    // Save the selected chip name
    await SettingsManager.setProbeRsChipName(chipName);
  }

  // Command - use probe-rs download with the merged.hex file. Arguments are
  // passed as an array so VS Code shell-quotes paths with spaces correctly.
  const tools = PlatformUtils.getToolExecutables();
  const downloadArgs = ["download", "--chip", chipName, "--binary-format", "hex", hexFilePath];

  // Append --probe flag if probeId is available
  if (probeId) {
    downloadArgs.push("--probe", probeId);
  }

  // Add verification flags from settings
  if (SettingsManager.getProbeRsPreverify()) {
    downloadArgs.push("--preverify");
  }

  if (SettingsManager.getProbeRsVerify()) {
    downloadArgs.push("--verify");
  }

  console.log(`probe-rs command: ${tools.probeRs} ${downloadArgs.join(" ")}`);

  const exec = new vscode.ShellExecution(tools.probeRs, downloadArgs, options);

  // Task
  const task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Flashing with probe-rs for ${project.board} using chip: ${chipName}`);

  // Run recovery --unlock-only before flashing (no-op if device is already unlocked)
  const recoveryPath = getRecoveryBinaryPath();
  if (recoveryPath) {
    console.log("Running recovery --unlock-only before flash...");
    const recovered = await runRecovery(options.env);
    if (!recovered) {
      return false;
    }
  }

  // Execute the flash task and wait for completion
  const exitCode = await executeTaskAndWait(task);
  if (exitCode !== 0) {
    console.error(`Flash task failed with exit code ${exitCode}`);
    vscode.window.showErrorMessage("probe-rs flash error! Check that your probe is connected and the chip name is correct.");
    return false;
  }

  console.log("Flash task completed successfully, now resetting device...");

  // Reset the device after successful programming (best-effort — firmware
  // that immediately sleeps or locks the debug port will cause this to fail,
  // which is fine since the device is already running the new firmware)
  const resetArgs = ["reset", "--chip", chipName];

  // Append --probe flag if probeId is available
  if (probeId) {
    resetArgs.push("--probe", probeId);
  }

  console.log(`probe-rs reset command: ${tools.probeRs} ${resetArgs.join(" ")}`);

  const resetExec = new vscode.ShellExecution(tools.probeRs, resetArgs, options);

  const resetTask = new vscode.Task(
    { type: "zephyr-tools", command: "Zephyr Tools: Reset Device" },
    vscode.TaskScope.Workspace,
    "Zephyr Tools: Reset Device",
    "zephyr-tools",
    resetExec,
  );

  await vscode.tasks.executeTask(resetTask);
  vscode.window.showInformationMessage("Device flashed successfully!");
  return true;
}

/**
 * Resolve the path to the recovery binary.
 * Checks the user setting first, then falls back to the tools directory.
 */
function getRecoveryBinaryPath(): string | undefined {
  // Check user-configured path first
  const configuredPath = SettingsManager.getRecoveryPath();
  if (configuredPath && fs.pathExistsSync(configuredPath)) {
    return configuredPath;
  }

  // Fall back to tools directory (installed via manifest)
  const tools = PlatformUtils.getToolExecutables();
  const toolsDir = SettingsManager.getToolsDirectory();
  const manifestPath = path.join(toolsDir, "recovery", tools.recovery);
  if (fs.pathExistsSync(manifestPath)) {
    return manifestPath;
  }

  return undefined;
}

/**
 * Run the recovery tool with --unlock-only to unlock a locked nRF91xx device.
 * Returns true if the device was successfully unlocked.
 */
async function runRecovery(env?: { [key: string]: string | undefined }): Promise<boolean> {
  const recoveryPath = getRecoveryBinaryPath();
  if (!recoveryPath) {
    vscode.window.showErrorMessage(
      "Recovery tool not found. Run 'Zephyr Tools: Setup' to install it, or set the path in settings (zephyr-tools.recovery.path)."
    );
    return false;
  }

  try {
    const { stdout, stderr } = await execFile(recoveryPath, ["--unlock-only"], {
      timeout: 30000,
      env: env as NodeJS.ProcessEnv,
    });
    console.log("Recovery stdout:", stdout);
    if (stderr) {
      console.log("Recovery stderr:", stderr);
    }
    return true;
  } catch (error: unknown) {
    console.error("Recovery failed:", error);
    const errObj = error as { stderr?: string; message?: string };
    const message = errObj.stderr || errObj.message || "Unknown error";
    vscode.window.showErrorMessage(`Device recovery failed: ${message}`);
    return false;
  }
}

/**
 * Standalone command to recover a locked nRF91xx device.
 */
export async function recoverDeviceCommand(
  _config: GlobalConfig,
  _context: vscode.ExtensionContext
): Promise<void> {
  const recoveryPath = getRecoveryBinaryPath();
  if (!recoveryPath) {
    vscode.window.showErrorMessage(
      "Recovery tool not found. Run 'Zephyr Tools: Setup' to install it, or set the path in settings (zephyr-tools.recovery.path)."
    );
    return;
  }

  const env = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());

  const choice = await vscode.window.showQuickPick(
    [
      { label: "Unlock Only", description: "Unlock device without erasing (no-op if already unlocked)", flag: "--unlock-only" },
      { label: "Erase and Unlock", description: "Full erase and unlock", flag: "--erase-only" },
      { label: "Verify Lock Status", description: "Check if device is locked (read-only)", flag: "--verify" },
    ],
    { placeHolder: "Select recovery operation" }
  );

  if (!choice) {
    return;
  }

  const options: vscode.ShellExecutionOptions = { env };
  const taskName = "Zephyr Tools: Recover Device";

  // recoveryPath is user-configurable and may contain spaces — pass as command +
  // args so VS Code shell-quotes it correctly.
  const exec = new vscode.ShellExecution(recoveryPath, [choice.flag], options);
  const task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Running device recovery: ${choice.label}`);
  await vscode.tasks.executeTask(task);
}

/**
 * Helper function to handle probe-rs probe selection for west flash command
 */
async function handleProbeRsProbeSelection(
  project: ProjectConfig,
  context: vscode.ExtensionContext,
  _config: GlobalConfig
): Promise<void> {
  // Use normalized environment from config
  const normalizedEnv = EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution());
  const availableProbes = await ProbeManager.getAvailableProbes(normalizedEnv);
  if (!availableProbes || availableProbes.length === 0) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return;
  }

  let probeId: string | undefined = SettingsManager.getProbeRsProbeId();

  if (availableProbes.length === 1) {
    // Single probe, use it automatically
    probeId = availableProbes[0].probeId;
    console.log(`Using single available probe: ${probeId}`);
    
    // Save the probe ID for future use
    if (probeId) {
      await SettingsManager.setProbeRsProbeId(probeId);
    }
  } else {
    // Multiple probes - check if we have a saved probe ID that's still available
    if (probeId) {
      const savedProbe = availableProbes.find(p => p.probeId === probeId);
      if (savedProbe) {
        console.log(`Using saved probe: ${probeId}`);
      } else {
        // Saved probe not found, clear it
        probeId = undefined;
      }
    }
    
    // If no saved probe or saved probe not found, let user choose
    if (!probeId) {
      const selectedProbe = await ProbeManager.selectProbe(availableProbes);
      if (!selectedProbe) {
        vscode.window.showErrorMessage("No probe selected for probe-rs flashing.");
        return;
      }
      probeId = selectedProbe.probeId;
      
      // Save the selected probe ID
      if (probeId) {
        await SettingsManager.setProbeRsProbeId(probeId);
      }
    }
  }

  // Update runnerParams with probe selection
  if (probeId) {
    const probeParam = `-O="--probe" -O="${probeId}"`;
    
    // If runnerParams already exists, append to it; otherwise set it
    if (project.runnerParams) {
      // Check if probe parameter already exists to avoid duplicates
      if (!project.runnerParams.includes('--probe')) {
        project.runnerParams += ` ${probeParam}`;
      } else {
        // Replace existing probe parameter (both -O flags)
        project.runnerParams = project.runnerParams.replace(/-O="--probe" -O="[^"]*"/, probeParam);
      }
    } else {
      project.runnerParams = probeParam;
    }
    
    await ProjectConfigManager.save(context, project);
  }
}

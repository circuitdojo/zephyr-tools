/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { GlobalConfig } from "../types";
import { ProjectConfigManager, ConfigValidator } from "../config";
import { SerialPortManager, ProbeManager } from "../hardware";
import { TaskManager } from "../tasks";
import { monitorCommand } from "./monitor";
import { changeBoardCommand } from "./board-management";
import { changeProjectCommand } from "./project-management";
import { ProjectConfig } from "../types";
import { PlatformUtils, EnvironmentUtils } from "../utils";
import { SettingsManager } from "../config/settings-manager";


export async function flashCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: any
): Promise<void> {
  let project = await ProjectConfigManager.load(context);

  // Auto-prompt for board if undefined (replicates old extension behavior)
  if (!project.board) {
    await changeBoardCommand(config, context);
    
    // Reload project config after changeBoardCommand
    project = await ProjectConfigManager.load(context);
    
    // Check again - if still undefined, show error and return
    if (!project.board) {
      vscode.window.showErrorMessage("You must choose a board before flashing.");
      return;
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
      return;
    }
  }

  // Options for Shell Execution with normalized environment
  let options: vscode.ShellExecutionOptions = {
    env: EnvironmentUtils.normalizeEnvironment(SettingsManager.buildEnvironmentForExecution()),
    cwd: project.target,
  };

  // Tasks
  let taskName = "Zephyr Tools: Flash";

  // Generate universal build path that works on windows & *nix
  let buildPath = path.join("build", project.board?.split("/")[0] ?? "");
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

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName, isBackground: true },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Flashing for ${project.board}`);

  // Set up task completion listener to refresh sidebar (flash may trigger build)
  let taskCompletionDisposable: vscode.Disposable | undefined;
  if (sidebarProvider) {
    taskCompletionDisposable = vscode.tasks.onDidEndTask((taskEvent) => {
      // Check if this is our flash task that completed
      if (taskEvent.execution.task === task) {
        console.log('Flash task completed, refreshing sidebar in 1 second...');
        // Small delay to ensure build artifacts are fully written if build occurred
        setTimeout(() => {
          if (sidebarProvider && typeof sidebarProvider.refresh === 'function') {
            sidebarProvider.refresh();
          }
        }, 1000);
        
        // Clean up the listener
        taskCompletionDisposable?.dispose();
      }
    });
  }

  // Start task here
  await vscode.tasks.executeTask(task);
}

export async function flashAndMonitorCommand(
  config: GlobalConfig,
  context: vscode.ExtensionContext,
  sidebarProvider?: any
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

    // Step 1: Flash the device
    await flashCommand(config, context, sidebarProvider);

    // Step 2: Set up serial port if not configured
    if (!project.port) {
      const port = await SerialPortManager.selectPort(config);
      if (!port) {
        vscode.window.showErrorMessage("Error obtaining serial port for monitoring.");
        return;
      }
      
      project.port = port;
      await ProjectConfigManager.save(context, project);
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
    const project = await ProjectConfigManager.load(context);

    // Step 1: Flash the device with probe-rs
    await flashProbeRsCommand(config, context);

    // Step 2: Set up serial port if not configured
    if (!project.port) {
      const port = await SerialPortManager.selectPort(config);
      if (!port) {
        vscode.window.showErrorMessage("Error obtaining serial port for monitoring.");
        return;
      }
      
      project.port = port;
      await ProjectConfigManager.save(context, project);
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
): Promise<void> {
  let project = await ProjectConfigManager.load(context);

  // Auto-prompt for project target if undefined (replicates old extension behavior)
  if (!project.target) {
    await changeProjectCommand(config, context);
    
    // Reload project config after changeProjectCommand  
    project = await ProjectConfigManager.load(context);
    
    // Check again - if still undefined, show error and return
    if (!project.target) {
      vscode.window.showErrorMessage("You must choose a project before flashing.");
      return;
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
      return;
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
    return;
  }

  // Check for available probes and handle settings
  let probeId: string | undefined = SettingsManager.getProbeRsProbeId();
  const availableProbes = await ProbeManager.getAvailableProbes(shellOptions.env);
  if (!availableProbes) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return;
  }
  
  if (availableProbes.length === 0) {
    vscode.window.showErrorMessage("No debug probes found. Please connect a probe and try again.");
    return;
  } else if (availableProbes.length === 1) {
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
        return;
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
      return;
    }
    
    // Save the selected chip name
    await SettingsManager.setProbeRsChipName(chipName);
  }

  // Command - use probe-rs download with the merged.hex file
  const tools = PlatformUtils.getToolExecutables();
  let cmd = `${tools.probeRs} download --chip ${chipName} --binary-format hex ${hexFilePath}`;
  
  // Append --probe flag if probeId is available
  if (probeId) {
    cmd += ` --probe ${probeId}`;
  }
  
  // Add verification flags from settings
  if (SettingsManager.getProbeRsPreverify()) {
    cmd += ` --preverify`;
  }
  
  if (SettingsManager.getProbeRsVerify()) {
    cmd += ` --verify`;
  }

  console.log("probe-rs command: " + cmd);

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-tools", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-tools",
    exec,
  );

  vscode.window.showInformationMessage(`Flashing with probe-rs for ${project.board} using chip: ${chipName}`);

  // Execute the flash task and wait for completion
  const taskExecution = await vscode.tasks.executeTask(task);
  
  // Create a promise that resolves when the task completes
  const taskCompletionPromise = new Promise<void>((resolve, reject) => {
    const disposable = vscode.tasks.onDidEndTask((e) => {
      if (e.execution === taskExecution) {
        disposable.dispose();
        resolve();
      }
    });
    
    const errorDisposable = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === taskExecution && e.exitCode !== 0) {
        disposable.dispose();
        errorDisposable.dispose();
        reject(new Error(`Flash task failed with exit code ${e.exitCode}`));
      }
    });
  });
  
  try {
    // Wait for the flash task to complete
    await taskCompletionPromise;
    
    console.log("Flash task completed successfully, now resetting device...");
    
    // Reset the device after successful programming
    let resetCmd = `${tools.probeRs} reset --chip ${chipName}`;
    
    // Append --probe flag if probeId is available
    if (probeId) {
      resetCmd += ` --probe ${probeId}`;
    }
    
    console.log("probe-rs reset command: " + resetCmd);
    
    let resetExec = new vscode.ShellExecution(resetCmd, options);
    
    let resetTask = new vscode.Task(
      { type: "zephyr-tools", command: "Zephyr Tools: Reset Device" },
      vscode.TaskScope.Workspace,
      "Zephyr Tools: Reset Device",
      "zephyr-tools",
      resetExec,
    );
    
    await vscode.tasks.executeTask(resetTask);
    vscode.window.showInformationMessage("Device flashed and reset successfully!");
    
  } catch (error) {
    console.error("Flash task failed:", error);
    vscode.window.showErrorMessage("probe-rs flash error! Check that your probe is connected and the chip name is correct.");
  }
}

/**
 * Helper function to handle probe-rs probe selection for west flash command
 */
async function handleProbeRsProbeSelection(
  project: ProjectConfig,
  context: vscode.ExtensionContext,
  config: GlobalConfig
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

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
import { createProcessExecution, createShellCommandExecution, executeTaskAndWait } from "../tasks";
import { FLASH_WORK_DIR, FlashImage, resolveFlashImages } from "../build/flash-hex";
import { hexHasData } from "../build/intel-hex";
import {
  NRF91_UICR_SIZE,
  NRF91_UICR_START,
  UicrWords,
  extractUicrWords,
  parseProbeRsRead32,
  planUicr,
  stripHexRange,
} from "../build/uicr";

const execFile = util.promisify(cp.execFile);

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
  // It runs under /bin/sh on POSIX so Ctrl-C is reported as a failure.
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

  const exec = createShellCommandExecution(cmd, options);

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
  const options: vscode.ProcessExecutionOptions = shellOptions;

  // Generate universal build path that works on windows & *nix
  const buildPath = path.join("build", project.board.split("/")[0]);
  const buildDir = path.join(project.target!, buildPath);
  const flashPlan = await resolveFlashImages(buildDir);
  if (!flashPlan.ok) {
    vscode.window.showErrorMessage(flashPlan.error);
    return false;
  }
  let images: FlashImage[] = flashPlan.images;

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

  const isNrf91 = chipName.toLowerCase().startsWith("nrf91");

  // The recovery tool is nRF91-specific. Run --unlock-only before flashing
  // (no-op if the device is already unlocked).
  if (isNrf91 && getRecoveryBinaryPath()) {
    console.log("Running recovery --unlock-only before flash...");
    const recovered = await runRecovery("unlock", probeId, options.env);
    if (!recovered) {
      return false;
    }
  }

  // nRF91 UICR can only be cleared by a full chip erase. Skip UICR writes that
  // are already on the device, or erase when any still need to be written.
  if (isNrf91) {
    const prepared = await prepareNrf91Uicr(buildDir, images, chipName, probeId, options.env);
    if (!prepared) {
      return false;
    }
    images = prepared;
  }

  vscode.window.showInformationMessage(`Flashing with probe-rs for ${project.board} using chip: ${chipName}`);

  // Download each image in flash order. Arguments are passed verbatim (no
  // shell parsing), so paths need no quoting.
  const tools = PlatformUtils.getToolExecutables();
  for (const image of images) {
    const downloadArgs = ["download", "--chip", chipName, "--binary-format", "hex", image.hexPath];

    // Append --probe flag if probeId is available
    if (probeId) {
      downloadArgs.push("--probe", probeId);
    }

    // Add verification flags from settings. Bootloader images rarely change,
    // so always preverify them to skip reprogramming when the device matches.
    if (SettingsManager.getProbeRsPreverify() || image.preverify) {
      downloadArgs.push("--preverify");
    }

    if (SettingsManager.getProbeRsVerify()) {
      downloadArgs.push("--verify");
    }

    console.log(`probe-rs command: ${tools.probeRs} ${downloadArgs.join(" ")}`);

    const exec = createProcessExecution(tools.probeRs, downloadArgs, options);

    const taskName = `Zephyr Tools: Flash ${image.label} with probe-rs`;
    const task = new vscode.Task(
      { type: "zephyr-tools", command: taskName },
      vscode.TaskScope.Workspace,
      taskName,
      "zephyr-tools",
      exec,
    );

    // Execute the flash task and wait for completion
    const exitCode = await executeTaskAndWait(task);
    if (exitCode !== 0) {
      console.error(`Flash task for ${image.hexPath} failed with exit code ${exitCode}`);
      vscode.window.showErrorMessage(`probe-rs flash error on ${image.label}! Check that your probe is connected and the chip name is correct.`);
      return false;
    }
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

  const resetExec = createProcessExecution(tools.probeRs, resetArgs, options);

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
 * Run the nRF91 recovery tool: --unlock-only unlocks a locked device,
 * --erase-only unlocks and erases the whole chip including UICR.
 * Returns true on success.
 */
async function runRecovery(
  mode: "unlock" | "erase",
  probeId: string | undefined,
  env?: { [key: string]: string | undefined }
): Promise<boolean> {
  const recoveryPath = getRecoveryBinaryPath();
  if (!recoveryPath) {
    vscode.window.showErrorMessage(
      "Recovery tool not found. Run 'Zephyr Tools: Setup' to install it, or set the path in settings (zephyr-tools.recovery.path)."
    );
    return false;
  }

  // The probe's USB interface can still be held briefly by the previous
  // probe-rs invocation, so wait longer than recovery's 2 s default to open it.
  // probe-rs resets the device when it flashes, so recovery's own final reset
  // is redundant.
  const args = [
    mode === "erase" ? "--erase-only" : "--unlock-only",
    "--no-reset",
    "--timeout", "10000",
    ...recoveryProbeArgs(probeId),
  ];

  try {
    // Worst case: 10 s to open the probe plus 3 unlock/erase retries.
    const { stdout, stderr } = await execFile(recoveryPath, args, {
      timeout: 60000,
      env: env as NodeJS.ProcessEnv,
    });
    console.log("Recovery stdout:", stdout);
    if (stderr) {
      console.log("Recovery stderr:", stderr);
    }
    return true;
  } catch (error: unknown) {
    console.error("Recovery failed:", error);
    const errObj = error as { stdout?: string; stderr?: string; message?: string };
    const message = errObj.stderr?.trim() || errObj.message || "Unknown error";
    // The last line recovery printed before failing shows how far it got.
    const lastStep = errObj.stdout?.trim().split(/\r?\n/).pop();
    vscode.window.showErrorMessage(
      `Device ${mode} failed: ${message}` + (lastStep ? ` (last step: ${lastStep})` : "")
    );
    return false;
  }
}

/**
 * Select the same probe for recovery as for probe-rs. probe-rs probe IDs are
 * VID:PID[:serial] with hex VID/PID, or a bare serial; recovery takes VID/PID
 * as decimal options and defaults them to the Feather's onboard probe.
 */
export function recoveryProbeArgs(probeId: string | undefined): string[] {
  if (!probeId) {
    return [];
  }
  const [vid, pid, ...serial] = probeId.split(":");
  const isHexId = (value: string | undefined): value is string => value !== undefined && /^[0-9a-f]{4}$/i.test(value);
  if (!isHexId(vid) || !isHexId(pid)) {
    return ["--serial", probeId];
  }
  const args = ["--vendor-id", String(parseInt(vid, 16)), "--product-id", String(parseInt(pid, 16))];
  if (serial.length > 0) {
    args.push("--serial", serial.join(":"));
  }
  return args;
}

/**
 * Compare the UICR words the images program with the device's UICR. Returns
 * the images to download (UICR stripped when already programmed; images left
 * empty are dropped), or undefined on failure or cancel. Erases the chip,
 * after confirmation, when UICR must be written.
 */
async function prepareNrf91Uicr(
  buildDir: string,
  images: FlashImage[],
  chipName: string,
  probeId: string | undefined,
  env?: { [key: string]: string | undefined }
): Promise<FlashImage[] | undefined> {
  const hexTexts = new Map<FlashImage, string>();
  const hexWords: UicrWords = new Map();
  for (const image of images) {
    const text = await fs.readFile(image.hexPath, "utf8");
    hexTexts.set(image, text);
    for (const [address, value] of extractUicrWords(text)) {
      hexWords.set(address, value);
    }
  }

  if (hexWords.size === 0) {
    return images;
  }

  const tools = PlatformUtils.getToolExecutables();
  const readArgs = [
    "read", "b32", `0x${NRF91_UICR_START.toString(16)}`, String(NRF91_UICR_SIZE / 4),
    "--chip", chipName,
  ];
  if (probeId) {
    readArgs.push("--probe", probeId);
  }

  let deviceWords: UicrWords;
  try {
    const { stdout } = await execFile(tools.probeRs, readArgs, {
      timeout: 30000,
      env: env as NodeJS.ProcessEnv,
    });
    deviceWords = parseProbeRsRead32(stdout, NRF91_UICR_START);
  } catch (error: unknown) {
    console.error("Reading UICR failed:", error);
    const errObj = error as { stderr?: string; message?: string };
    vscode.window.showErrorMessage(`Reading device UICR failed: ${errObj.stderr || errObj.message || "Unknown error"}`);
    return undefined;
  }

  const plan = planUicr(hexWords, deviceWords);

  if (plan.action === "erase") {
    const addresses = plan.addresses.map(a => `0x${a.toString(16).padStart(8, "0")}`).join(", ");
    console.log(`UICR differs from the build at ${addresses}`);
    const choice = await vscode.window.showWarningMessage(
      "UICR changed. Erase the chip to flash?",
      {
        modal: true,
        detail:
          "This clears all stored data.\n\nTip: set SB_CONFIG_SECURE_BOOT_SIGNING_KEY_FILE so pristine builds keep the same b0 key.",
      },
      "Erase and Flash"
    );
    if (choice !== "Erase and Flash") {
      return undefined;
    }
    // TODO: switch to `probe-rs download --chip-erase` once a probe-rs release
    // includes #4226 (CTRL-AP ERASEALL for nRF91), and drop this recovery step.
    if (!(await runRecovery("erase", probeId, env))) {
      return undefined;
    }
    return images;
  }

  console.log("UICR already matches the build; skipping UICR writes");
  const stripped: FlashImage[] = [];
  for (const image of images) {
    const text = hexTexts.get(image)!;
    if (extractUicrWords(text).size === 0) {
      stripped.push(image);
      continue;
    }
    const strippedText = stripHexRange(text);
    if (!hexHasData(strippedText)) {
      continue;
    }
    const strippedPath = path.join(buildDir, FLASH_WORK_DIR, "uicr-stripped", path.basename(image.hexPath));
    await fs.outputFile(strippedPath, strippedText);
    stripped.push({ ...image, hexPath: strippedPath });
  }
  return stripped;
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

  const options: vscode.ProcessExecutionOptions = { env };
  const taskName = "Zephyr Tools: Recover Device";

  // recoveryPath is user-configurable and may contain spaces; it is run
  // without shell parsing.
  const exec = createProcessExecution(recoveryPath, [choice.flag], options);
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

# Auto-Generate probe-rs Debug Configuration Plan

## Goal
- Auto-generate a probe-rs debug configuration based on the selected project/board, and surface it in Run and Debug without manual `launch.json` edits.

## Inputs
- `ProjectConfig` (`board`, `target`, `sysbuild`) from `ProjectConfigManager`.
- probe-rs settings (`probeId`, `chipName`, `preverify`, `verify`) from `SettingsManager`.
- Build output structure under `target/build/<board>/...`.
- Optional: detected probe list and chip list via `ProbeManager`.

## User Flow
- User selects project and board as usual.
- On first build or explicit “Create Debug Configuration” command, the extension generates a probe-rs launch configuration.
- The generated config appears in the debug dropdown; user can start a session immediately.
- If chip or probe is unknown, prompt to select once and remember settings.

## ELF Discovery
- Determine build dir: `target/build/<board-base>/`.
- Preferred ELF: `build/<board-base>/zephyr/zephyr.elf`.
- Fallbacks:
  - `build/<board-base>/app/zephyr/zephyr.elf` (app image in sysbuild).
  - Additional core images if detected (e.g., `spm/zephyr/zephyr.elf`, `tfm/zephyr/zephyr.elf`).
- Resolve multicore by scanning for sibling `*/zephyr/zephyr.elf` under the same build directory; order by known core naming or heuristics.

## Chip and Probe Resolution
- Use `SettingsManager.getProbeRsChipName()`; if unset, prompt with `ProbeManager.getProbeRsChipName()` to select and save.
- If multiple probes:
  - Use saved `probeId` if still connected; else prompt via `ProbeManager.selectProbe()` and save.
- If one probe connected: auto-select and save.
- Respect `preverify`/`verify` flags if enabled.

## Launch Configuration Shape
- Single-core:
  - `type: "probe-rs-debug"`, `request: "attach"`, `chip`, `coreConfigs[0].programBinary = <elf>`, `cwd = ${workspaceFolder}`, optional `speed = 4000`, `consoleLogLevel = "Console"`.
- Multicore:
  - `coreConfigs` array with entries for each discovered ELF; set `coreIndex` deterministically (e.g., 0 = app, 1 = SPM/TF-M) and `programBinary` per core.
- Naming:
  - `name = "<Board> • App"` or `"• App (Non-Secure)"` when applicable; include chip for clarity when helpful.

## Persistence Strategy
- Prefer persistent configuration in `.vscode/launch.json`:
  - Create file if missing, merge if present.
  - Update or replace entries this extension owns (match by a stable `zephyrToolsId` field or name pattern).
- Provide a user setting to opt into “ephemeral session” (don’t persist) as a phase-2 enhancement.

## Triggers to Generate/Update
- On successful build completion.
- On `ProjectConfigManager.onDidChangeConfig` when `board` or `target` changes.
- On explicit command “Zephyr Tools: Create Debug Configuration”.
- Optionally, on probe/chip setting changes.

## Safety and Merging Rules
- Never overwrite user-defined non-Zephyr entries.
- When updating, match on:
  - A hidden marker field (e.g., `zephyrToolsId`) or
  - Name pattern + `type: probe-rs-debug` within this workspace.
- Keep an idempotent merge to avoid duplicate entries.

## Commands and UX
- Add command: “Create Debug Configuration” (creates/updates and notifies).
- Add command: “Debug App Now” (ensures config exists, then calls `vscode.debug.startDebugging` with it).
- If required fields missing (chip/probe/ELF), show actionable prompts with clear next steps.

## Edge Cases
- No build artifacts: prompt to build, offer to run “Build”.
- Sysbuild off: expect ELF at `zephyr/zephyr.elf` only.
- Different templates (vanilla/nfed/ncs): scan build tree rather than hardcode.
- Multiple workspaces: scope to the active folder only.
- Absent probe-rs VS Code debugger: warn and link to install.

## Validation
- Test with:
  - nRF91x1 non-secure app only.
  - Sysbuild project with app + SPM/TF-M.
  - Single and multiple connected probes.
- Verify launch dropdown displays exactly one up-to-date config per project/board.
- Confirm session starts, attaches, and breaks at main.

## Documentation
- Short section in README:
  - How generation works.
  - Where files live (`.vscode/launch.json`).
  - How to change chip/probe settings.
  - Troubleshooting missing ELF and multiple probes.

## Future Enhancements
- Dynamic `DebugConfigurationProvider` to avoid writing files.
- Board-to-chip auto-mapping from Zephyr board metadata.
- Multi-target workspaces and multiple named configs.
- Speed and RTT/semihosting settings per user preference.


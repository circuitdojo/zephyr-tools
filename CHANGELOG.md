# Change Log

All notable changes to the "zephyr-tools" extension will be documented in this file.

### [0.4.1] - 2025-07-23

Added:
- Automatic probe-rs detection and usage for Circuit Dojo boards
- Smart flash command routing based on board selection

Changed:
- Flash command now automatically uses probe-rs for Circuit Dojo boards instead of west flash
- Flash & Monitor command automatically uses probe-rs for Circuit Dojo boards
- Simplified sidebar UI by removing redundant "Flash via probe-rs & Monitor" button
- Circuit Dojo boards get optimized flashing experience without manual runner selection

Improved:
- Streamlined user experience - one flash button works optimally for all board types
- Reduced UI complexity while maintaining full functionality via Command Palette
- Better board-specific optimization with transparent user experience

### [0.4.0] - 2025-07-23

Major Release 0.4.0 - 2025-07-23

A comprehensive overhaul with improvements in architecture, maintainability, and user experience. Key highlights include:

Architecture and Code:
- Modular design with distinct modules for commands, configuration, UI, hardware management, and more.
- Improved TypeScript practices and error handling.
- Centralized configuration and task management.

User Experience Improvements:
- Enhanced auto-prompting for configuration.
- Restored seamless folder selection.
- Improved build and flash commands to match original behavior.

Technical Improvements:
- Centralized validation and dialog management.
- Better error messaging and code organization.

Bug Fixes and Compatibility:
- Resolved build and repo initialization errors.
- Fixed TypeScript compilation issues.

Developer Experience:
- Comprehensive documentation and improved tooling.

This release ensures backward compatibility while enhancing reliability and maintainability.

### [0.3.8]

Added: 
- Caching `probe-rs` settings
- `Zephyr Tools: Change probe-rs Settings` command for resetting/updating


### [0.3.7]

Added:

- Status bar items showing current board and project selection with clickable interface
- Visual indicators for board (circuit-board icon) and project (folder icon) in status bar
- Interactive tooltips displaying full names and click instructions for status bar items
- Smart text truncation for long board and project names in status bar display
- Support for probe-rs flashing with automatic chip detection and user selection
- Enhanced hex file path resolution for probe-rs (checks both zephyr subdirectory and board directory)
- Automatic status bar updates when board or project configuration changes
- Intelligent probe selection for probe-rs flashing with support for multiple connected probes
- Automatic probe identifier extraction from probe-rs list output for precise probe targeting
- Enhanced probe parsing supporting both CMSIS-DAP (VID:PID:Serial) and J-Link (Serial) probe formats
- Probe-specific command execution using --probe flag for both download and reset operations

Changed:

- Status bar items positioned on the right side of VS Code status bar
- Flash probe-rs command now uses TaskManager for proper error handling and user feedback
- Improved error messaging for probe-rs flashing failures (connection and chip selection issues)
- Enhanced user experience with one-click access to board and project change dialogs
- Probe-rs commands now include specific probe identifiers when multiple probes are connected
- Probe selection interface displays full probe descriptions with extracted identifiers

Fixed:

- Probe-rs flashing errors now display in user-visible error popups instead of console only
- Missing hex file detection with clear error messages for both possible file locations
- Status bar items properly disposed on extension deactivation to prevent memory leaks
- Multiple probe scenarios now work correctly with proper probe identification and selection

### [0.3.6]

Added:

- Default project configuration constant for consistent sysbuild behavior across all commands

Changed:

- Sysbuild is now enabled by default for all new projects (was previously disabled)
- Added 7zip-bin as external dependency in esbuild configuration to prevent binary bundling

Fixed:

- 7zip extraction ENOENT errors by excluding 7zip-bin from bundling, allowing binary files to remain in node_modules
- Load via Bootloader command now correctly checks for dfu_application.zip existence before extraction
- Load via Bootloader now supports both .signed.bin (newer SDK) and .bin (older SDK) file formats

### [0.3.5]

Added:

- Python version detection to ensure Python 3.10+ is used for virtual environment creation
- Proper 7zip-bin API usage instead of manual path construction for cross-platform compatibility
- Logging for west update and pip install sequence in Init Repo command

Changed:

- Fixed race condition in "Init Repo" where pip install ran before west update completed
- Fixed PATH environment variable handling to use prepend instead of replace, preserving system paths
- Fixed toolchain selection QuickPick focus loss by moving selection outside progress window
- Fixed debug configuration to use TypeScript compiled files instead of esbuild bundled files
- Fixed main entry point in package.json and extension wrapper for proper development/production builds
- TaskManager now executes callbacks for all successful tasks, not just last tasks
- Removed retry operations for downloads and ZIP extraction to simplify error handling

Fixed:

- 7zip extraction silent failures due to incorrect binary path detection
- Extension activation errors when compiled files were in wrong directory
- Windows TypeScript compilation issues by using proper tsc commands

### [0.3.4]

Changed:

- Updated dependencies and improved build configuration

### [0.3.3]

Changed:

- Handling of new dfu_application.zip output when running "Load via Bootloader" command

### [0.3.2]

Changed:

- Autodetecting available runners
- Fixing path generation in Windows

### [0.3.1]

Changed:

- Updated `mocha` testing framework

### [0.3.0]

Added:

- Can configure `west` runner with `Zephyr Tools: Change Runner` including extra params for power users
- Can enable and disable use of `--sysbuild` flag for `west build`
- Board search is now more efficent. Also compatible with HWMv2

Changed:

- Now does not cancel running tasks for `Zephyr Tools: Build` and `Flash` commands. (Useful for keeping `Serial Monitor` alive)

### [0.2.3]

Changed:

- Fixed manifest entries for Windows
- Added 7z support
- Updating pkg dependencies
- `process_download` now returns to avoid continuing if error

### [0.2.2]

Changed:

- Updated MD5 hashes for Mac downloads
- Fixed issue of toolchain setup requiring cmake before cmake is installed

### [0.2.1]

Changed:

- Users are now required to bootstrap `pip` if not already (fixes setup bug with `ensurepip` command)

### [0.2.0]

Added:

- Functionality for pulling in different versions of the Zephyr SDK (compiler, etc)

### [0.1.34]

Changed:

- Moving all deps into `deps` folder

### [0.1.33]

Create project

Added:

- Create Project command with options to start with Vanilla or NCS.

### [0.1.32]

Fixing setup bug

Changed:

- Environment is not exported when installing toolchain. Leads to errors during project compilation.

### [0.1.31]

Changing license

Changed:

- Changed to Apache 2.0. Opened the source on Github

### [0.1.30]

Update manifest for latest version of zephyr-tools CLI

Changed:

- Up-rev manifest v ersion
- Pointing to latests zephyr tools for all platforms (0.1.6)

### [0.1.29]

Changed:

- M1 macs use `arm64` arch name insteado of `aarch64`

### [0.1.28]

Changed:

- Automagically places circuitdojo_nrf9160_feather_ns into BL mode
- Updated version of zephyr-tools CLI tool to 0.1.5
- Added aarch64 target for Mac
- Using Zephyr toolchain for all targets (0.15.1)

### [0.1.27]

Changed:

- Fixing SDK install issues with manifest flag.

### [0.1.26]

Changed:

- Increased timeout for newtmgr from 0.1 to 0.25s

### [0.1.25]

Changed:

- Improved relabiltiy for transfers over USB when loading a new image.

### [0.1.24]

Changed:

- List now includes app_update.bin and zephyr.signed.bin

### [0.1.23]

Changed:

- Asks for branch name or uses default if nothing is entered
- Added a delay between programming and resetting device using mcumgr

### [0.1.22]

Changed:

- All directories now checked for boards. (Particularly useful for nRF NCS and boards like Thingy91)

### [0.1.21]

Added:

- Custom downloader implementation to fix CA cert issues on Windows (and to have more control!)

Changed;

- Extension.ts now uses FileDownloader

Removed:

- Use of file downloader from MS
- Need for extension dep (file-downloader)

### [0.1.20]

Changed:

- cwd is set for monitor command
- Removing 'k' flag for tar since we _need_ to overwrite files.

### [0.1.19]

Updating zephyr-tools-monitor to allow for saving of logs.

Added:

- setup-monitor command

Changed:

- Manifest uprev to 9.
- Updated version of zephyr-tools-monitor to 0.1.2

### [0.1.18]

Fixed bug with `Load` command.

Changed:

- Using project target as the path for app_update.bin (this was already done for the other load/flash commands)

### [0.1.17]

Added:

- Creating custom settings.json to disable built in git client

Changed:

- Config.path only necessary items
- Removed env: config.env for many setup tasks
- Added setting of VIRTUAL_ENV
- Checking for .west instead of .git

### [0.1.16]

    Changed:
    * Instead of cloning and then initializing, clone directly using west init

    Removed:
    * Second west init as it's not needed

### [0.1.15]

**Important change** build directory is local to the sample being built. For example, `app/samples/tracker` now builds to `app/samples/tracker/build/` instead of `app/build`.

Changed:

- Using project.target for build directory
- Use of fs.remove instead of vscode.workspace.fs
- Build also cancels running tasks

Added:

- Message indicating clean success

### [0.1.14]

Changed:

- Due to the addition of manifestVersion, can't iterate by object entries now.

Added:

- Version checks at the start of each command

### [0.1.13]

Changed:

- Fixing issue setting newtmgr serial connection

Removed:

- Finished TODOs

### [0.1.12]

Added:

- Load and monitor functionality
- Flash and monitor functionality as well

Changed:

- For quickPick, enabling ignoreFocusOut otherwise we get failures
- Canceling running tasks for the flash/load commands
- Saving of port either determined by a monitor command or newtmgr (should be the same port no matter what)

### [0.1.11]

Added:

- Created monitor command for monitoring serial

Changed:

- Brought out getPort and getBaud so they can be re-used

### [0.1.10]

### Removed:

- Use of serialports npm package

### Added:

- Additional download and use of zephyr-tools-monitor

## [0.1.9]

### Changed:

- west flash uses nrfjprog by default
- adding a note to investigate using probe-rs to avoid installing j-link and nrfjprog
- Success message using showInformationMessage
- Changing success message for reset function

## [0.1.8]

### Added:

- Setup for `newtmgr`
- Loading via `newtmgr` to devices with bootloader

## [0.1.7]

### Changed:

- `west flash` with `--softreset --erase` flags

## [0.1.6]

### Changed:

- Blank `git` URL handling for initialization command
- Updating Readme checklist

## [0.1.5]

### Changed:

- Downloading newtmgr
- Commented out updating of PATH env variable
- Making sure that PATH doesn't get completely clobbered
- Fixing path check for Init (use fsPath instead)
- Updated changelog

## [0.1.4]

### Changed:

- Wrapped ensurepip in conditional to ignore on Linux
- Manifest for Linux is populated
- Updated Ubuntu requirements
- Added other extensions as a pack
- Setup cancelable turning off since it wont cancel anything.. 😅

## [0.1.3]

### Added:

- Simple get workspace root function
- Activation event at startup for init
- Creation of PendingTask that is run on startup (useful for changing workspace)

### Changed:

- Move callback within the success area of Task Manager.
- Init function separate now from task
- Checking for invalid urls for init

## [0.1.2]

### Changed:

- shellOptions to include cwd

### Added:

- Actually calling callback on success
- isInit for project to make sure requirements.txt is processed first.

## [0.1.0]

### Added:

- Notes for deps on Windows and Linux

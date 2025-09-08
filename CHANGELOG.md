# Change Log

All notable changes to the "zephyr-tools" extension will be documented in this file.

### [0.5.3] - 2025-09-08

**Updates:**
- **Updated zephyr-tools CLI**: Updated to zephyr-tools-cli v0.1.8 across all platforms

### [0.5.2] - 2025-08-27

**New Features:**
- **Serial & Newtmgr Settings Migration**: Migrated all serial and newtmgr configuration to VS Code settings for better persistence and discoverability
- **Enhanced Settings Management**: All hardware configuration now managed through VS Code settings instead of project config
- **Improved Newtmgr UI**: Updated "Setup Newtmgr" command to "Newtmgr Settings" with menu options to configure port, baud rate, or test connection

**Settings Added:**
- `zephyr-tools.serial.port`: Serial port for monitoring and flashing
- `zephyr-tools.serial.saveLogsToFile`: Enable saving serial monitor output to log files  
- `zephyr-tools.newtmgr.baudRate`: Default baud rate for newtmgr connections

**Technical Changes:**
- Removed serial/newtmgr settings from ProjectConfig (port, saveSerialLogs)
- Added SettingsManager methods for all serial and newtmgr configuration
- Updated all monitor, flash, and load commands to use VS Code settings
- Improved settings persistence across sessions

### [0.5.1] - 2025-08-27

**New Features:**
- **probe-rs Settings Migration**: Migrated all probe-rs configuration to VS Code settings for better persistence and discoverability
- **Verification Flags**: Added --preverify and --verify flag support for probe-rs download operations
- **Enhanced Settings UI**: Updated probe-rs settings command with verification options and multi-select interface

**Settings Added:**
- `zephyr-tools.probeRs.chipName`: Chip name for probe-rs operations
- `zephyr-tools.probeRs.probeId`: Probe ID for probe-rs operations 
- `zephyr-tools.probeRs.preverify`: Enable --preverify flag to verify memory before flashing
- `zephyr-tools.probeRs.verify`: Enable --verify flag to verify memory after flashing

**Technical Changes:**
- Removed probe-rs settings from ProjectConfig (probeRsProbeId, probeRsChipName)
- Added SettingsManager methods for all probe-rs configuration
- Updated flash commands to use VS Code settings instead of project configuration

### [0.5.0] - 2025-08-27

Major Architecture Refactor - VS Code Settings Integration:

**New Features:**
- **VS Code Settings Integration**: Complete migration from hardcoded paths to VS Code settings API for proper persistence
- **Path Reset Command**: Added `Zephyr Tools: Reset Paths` command for troubleshooting configuration issues
- **Auto-Detection**: Intelligent auto-detection of Python, West, and Zephyr SDK installations
- **Settings UI**: New configuration options in VS Code settings for customizing tool paths:
  - `zephyr-tools.paths.toolsDirectory`: Custom tools directory location
  - `zephyr-tools.paths.pythonExecutable`: Custom Python path
  - `zephyr-tools.paths.zephyrBase`: Custom ZEPHYR_BASE path
  - `zephyr-tools.paths.westExecutable`: Custom West path
  - `zephyr-tools.paths.allPaths`: View all configured paths
  - `zephyr-tools.environment.variables`: Custom environment variables

**Architecture Improvements:**
- **SettingsManager**: New centralized class for all path and environment configuration
- **Workspace/Machine Scopes**: Proper support for workspace-specific and machine-wide settings
- **Path Discovery**: Comprehensive tool discovery across standard installation locations
- **Environment Building**: Unified environment variable construction through SettingsManager

**Fixed:**
- **Critical Circular Dependency**: Resolved circular dependency between `constants.ts` and `settings-manager.ts`
- **Runtime Reference Error**: Fixed `currentToolsDir is not defined` error in setup command
- **Incomplete Path Manager**: Completed `getStandardToolPaths()` implementation
- **Import Consistency**: Converted all `require()` to ES6 `import` statements
- **Manifest Paths**: Fixed trailing slashes in manifest.json suffix paths causing path issues
- **Linux Toolchain**: Fixed inconsistent suffix handling for Linux toolchain entries

**Breaking Changes:**
- Path management now uses VS Code settings instead of global constants
- Environment configuration moved from GlobalConfig to SettingsManager
- All commands now use `SettingsManager.buildEnvironmentForExecution()` for environment setup

### [0.4.12] - 2025-08-21

Project Creation Enhancement:

**Added:**
- **NFED Template Support**: Added "NFED (Circuit Dojo Boards)" option to project creation for nRF9151 Feather development
- **Circuit Dojo Integration**: New project template automatically configures the nrf9160-feather-examples-and-drivers repository

### [0.4.11] - 2025-08-20

Bug Fixes and UI Improvements:

**Fixed:**
- **Create Project Command**: Fixed race condition where `west init` was executed in wrong directory, preventing `west update` from running properly

**Added:**
- **Incomplete Project Detection**: New UI state detects and handles incomplete Zephyr projects (when .west folder exists but initialization didn't complete)
- **Resume Initialization**: Users can now resume interrupted project initialization directly from the sidebar without folder selection dialogs
- **Clean Incomplete Project**: Safe removal of incomplete projects with confirmation dialog to start fresh

**Improved:**
- **Serial Settings Menu**: Consolidated serial port and logging settings into a single "Serial Settings" menu, matching the probe-rs settings UI pattern
- **Serial Logging Configuration**: Changed from toggle to explicit Enable/Disable dropdown for clearer user control
- **Sidebar Organization**: Replaced "Setup Serial Monitor" with unified "Serial Settings" option in Advanced Settings

### [0.4.10] - 2025-08-11

Board Selection Enhancement:

**Added:**
- **Custom Board Entry**: Added "Enter custom board..." option to board selection dropdown, allowing manual entry of complex board identifiers
- **Multi-core Board Support**: Users can now enter board configurations like `stm32h747i_disco/stm32h747xx/m4` for multi-core processors
- **Custom Board Indicator**: Sidebar displays tooltip for custom board configurations to indicate manual entry

**Improved:**
- **Board Selection Flexibility**: Enhanced board selection to support both dropdown selection and manual text entry for edge cases

### [0.4.9] - 2025-08-10

UI Enhancement:

**Added:**
- **Loading Dialog**: Sidebar now shows a clean loading dialog with progress bar during initial load instead of showing project view with "Loading..." placeholders
- **Zephyr Terminal Command**: New `zephyr-tools.open-zephyr-terminal` command opens a terminal with Python virtual environment pre-activated
- **Sidebar Terminal Button**: Added "Open Zephyr Terminal" button with kite emoji (🪁) to the Quick Actions section
- **Environment Integration**: Terminal automatically inherits all Zephyr tool paths and environment variables for seamless development

**Improved:**
- **Better Loading UX**: Enhanced initial sidebar loading experience with dedicated loading state

### [0.4.8] - 2025-08-10

Project Workspace Detection Enhancement:

**Fixed:**
- **Project Detection in Parent Directories**: Fixed issue where extension incorrectly detected projects in parent Git folders when projects only existed in subfolders
- **Clean Folder Validation**: Added .west folder check during project creation to ensure target folder is clean/empty before creating new projects

**Improved:**
- **Workspace State Detection**: Enhanced sidebar state determination to verify .west folder actually exists in current workspace
- **Project Creation Safety**: Prevent overwriting existing Zephyr workspaces during project creation

### [0.4.7] - 2025-07-25

User Interface Enhancement:

**Added:**
- **Filename Display for Build Assets**: JavaScript update to show actual filename below the description in the asset list with lighter grey style
- **Enhanced Asset Information**: Build assets now display both description and actual filename for better file identification
- **Automatic Sidebar Refresh**: Build assets now refresh automatically after build and flash commands complete
- **Smart Task Completion Listeners**: Build and flash commands now trigger sidebar refresh when they complete

**Fixed:**
- **Scrollbar Rendering**: Adjusted UI to handle complex scrollbar rendering issues
- **Asset Display Clarity**: Improved visual hierarchy in build assets list with proper filename extraction and styling
- **Build Assets Not Refreshing**: Fixed issue where build assets would only appear after manual sidebar refresh or navigation

**Improved:**
- **File Watcher Performance**: Optimized build assets watcher to monitor only specific output files instead of entire build directory
- **Reduced Watcher Events**: Added debouncing and specific file pattern watching to prevent excessive refresh calls during builds
- **Watcher Management**: Prevented redundant watcher recreation with project-specific tracking

**Technical:**
- Updated sidebar JavaScript to extract and display filenames from full asset paths
- Added filename line rendering with appropriate styling hooks for CSS integration
- Enhanced asset list user experience with dual-line information display
- Added task completion listeners to build and flash commands for automatic sidebar refresh
- Implemented optimized file watchers with 2-second debouncing and specific file pattern matching
- Added project-specific watcher tracking to prevent unnecessary recreation

### [0.4.5] - 2025-07-24

User Interface Enhancement:

**Added:**
- **Update Dependencies Button**: New "Update Dependencies" button in Quick Actions sidebar for easy dependency management
- **Improved Button Layout**: Monitor and Update Dependencies buttons now display side by side in 2-column grid layout
- **Consistent Button Styling**: Update Dependencies button uses tertiary styling to match other utility buttons

**Improved:**
- **Better Space Utilization**: Quick Actions grid now uses consistent 2-column layout for all button pairs
- **Visual Consistency**: All action buttons follow same styling hierarchy without unnecessary highlighting
- **Enhanced User Experience**: One-click access to dependency updates directly from sidebar interface

**Updated:**
- **README Documentation**: Updated TODO list to reflect completed features including project configuration, probe-rs integration, board caching, and manifest validation
- **Feature Status**: Marked implemented features as complete including dependency reinstallation and serial logging configuration

**Technical:**
- Added Update Dependencies button to both TypeScript sidebar provider and JavaScript client implementations
- Updated CSS grid layout to accommodate new button arrangement
- Leveraged existing `zephyr-tools.update` command for seamless integration
- Maintained responsive design across all sidebar widths

### [0.4.4] - 2025-07-23

User Interface Enhancement:

**Added:**
- **Setup Progress in Sidebar**: New real-time progress indicator when running Zephyr Tools setup command
- **Animated Setup State**: Sidebar now shows "Setting Up Zephyr Tools" state with animated progress bar during setup process
- **Setup-Specific Progress Steps**: Displays relevant setup steps (Python validation, dependency installation, toolchain download)
- **Sidebar Auto-Reveal**: Sidebar automatically opens and focuses during initialization and setup processes
- **Robust Error Handling**: Setup progress state is properly cleared on completion, cancellation, or errors

**Improved:**
- **Immediate Visual Feedback**: Users see setup progress in sidebar immediately when clicking "Run Setup" button
- **Consistent Progress Design**: Reuses existing initialization progress UI pattern for familiarity
- **Non-Intrusive Progress**: Setup progress shown in sidebar alongside existing VS Code notification progress
- **Real-time State Updates**: Sidebar automatically updates when setup completes or fails
- **Enhanced Init Experience**: Sidebar automatically reveals when switching folders during project initialization

**Technical:**
- Added `isSetupInProgress` flag to `GlobalConfig` type and configuration management
- Enhanced sidebar state detection to prioritize setup progress state
- Added `showSetupInProgressState()` function with setup-specific messaging and progress steps
- Added comprehensive error handling with try-catch-finally to ensure progress state cleanup
- Extended CSS with `.setup-in-progress` class reusing existing progress bar animations
- Added `revealSidebar()` method with robust view initialization handling
- Enhanced pending task execution to auto-reveal sidebar for init-repo commands
- Added delayed sidebar reveal mechanism to handle workspace switching timing issues

### [0.4.3] - 2025-07-23

User Interface and Initialization Improvements:

**Fixed:**
- **Sidebar Button Overflow**: Resolved Create Project and Init Repo buttons overlapping their card boundaries in narrow sidebar widths
- **Initialization State Management**: Fixed sidebar not updating to show initialization progress when running init commands
- **Responsive Design**: Enhanced button layout and text wrapping to work consistently across all sidebar widths (down to 200px)

**Added:**
- **Initializing State UI**: New "Initializing Project" state with animated progress bar and helpful status information
- **Manifest Validation**: Comprehensive validation system that automatically detects missing or corrupted Zephyr Tools setup files
- **Auto-Reset Setup**: Setup flag is automatically reset when manifest validation fails, prompting users to re-run setup
- **Real-time Sidebar Updates**: Sidebar now updates immediately when global or project configuration changes
- **Enhanced CSS Styling**: Added progress bar animations, improved button containment, and extreme width responsive breakpoints

**Improved:**
- **Button Layout**: Action buttons now properly wrap text and stay within card boundaries at all sidebar widths
- **Initialization Feedback**: Users now see immediate visual feedback when project initialization begins
- **Error Handling**: Enhanced error recovery with proper cleanup of initialization state flags
- **Validation System**: More robust checking of Python environments, toolchains, and required executables
- **Configuration Management**: Better event handling for configuration changes with proper async validation

**Technical:**
- Enhanced `ConfigValidator` with physical manifest validation checking file existence and executable functionality
- Added `ManifestValidator` module for comprehensive setup validation beyond configuration checks
- Improved `ProjectConfigManager` and `GlobalConfigManager` with proper event emission for real-time updates
- Added proper `isInitializing` flag management throughout the initialization workflow
- Enhanced CSS with layout containment, overflow protection, and smooth progress animations
- Updated all command files to properly await async validation calls

### [0.4.2] - 2025-07-23

User Experience Improvements:
- Enhanced sidebar with intelligent state detection and contextual UI
- **Setup Required State**: Clean warning interface when Zephyr Tools hasn't been set up
- **Project Required State**: Guided interface for initializing Zephyr projects in non-Zephyr workspaces
- **Ready State**: Full functionality when everything is properly configured
- **Extension Pack Changes**: Converted required extensions to optional recommendations

Added:
- Smart sidebar state detection based on setup and project initialization status
- State-specific UI rendering with appropriate guidance and available actions
- Contextual help text explaining next steps for each state
- Progressive disclosure - only show relevant options for current state
- Visual consistency with VS Code theme colors and styling patterns
- Recommended Extensions section in README with clear descriptions

Changed:
- Extension pack dependencies are now optional workspace recommendations instead of required installations
- Extensions (C/C++ tools, nRF DeviceTree, nRF Kconfig) are suggested but not forced on users
- Users receive VS Code notifications to install recommended extensions with choice to accept or decline
- Updated .vscode/extensions.json to include previous extension pack items as recommendations

Improved:
- New user onboarding experience with clear guidance
- Reduced confusion from disabled buttons and unclear error states
- Better visual hierarchy with prominent call-to-action buttons
- Accessibility support maintained across all states
- Dynamic content rendering with proper event handling
- User choice and control over extension installation

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

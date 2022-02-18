# Change Log

All notable changes to the "zephyr-tools" extension will be documented in this file.

### [0.1.21]

Added:
* Custom downloader implementation to fix CA cert issues on Windows (and to have more control!)

Changed;
* Extension.ts now uses FileDownloader

Removed:
* Use of file downloader from MS
* Need for extension dep (file-downloader)

### [0.1.20]

Changed:
* cwd is set for monitor command
* Removing 'k' flag for tar since we *need* to overwrite files.

### [0.1.19]

Updating zephyr-tools-monitor to allow for saving of logs.

Added:
* setup-monitor command

Changed:
* Manifest uprev to 9.
* Updated version of zephyr-tools-monitor to 0.1.2

### [0.1.18]

Fixed bug with `Load` command.

Changed:
* Using project target as the path for app_update.bin (this was already done for the other load/flash commands)

### [0.1.17]

Added:
* Creating custom settings.json to disable built in git client

Changed:
* Config.path only necessary items
* Removed env: config.env for many setup tasks
* Added setting of VIRTUAL_ENV
* Checking for .west instead of .git


### [0.1.16]

    Changed:
    * Instead of cloning and then initializing, clone directly using west init
    
    Removed:
    * Second west init as it's not needed

### [0.1.15]

**Important change** build directory is local to the sample being built. For example, `app/samples/tracker` now builds to `app/samples/tracker/build/` instead of `app/build`.

Changed:
* Using project.target for build directory
* Use of fs.remove instead of vscode.workspace.fs
* Build also cancels running tasks

Added:
* Message indicating clean success

### [0.1.14]

Changed:
* Due to the addition of manifestVersion, can't iterate by object entries now.

Added:
* Version checks at the start of each command

### [0.1.13]

Changed:
* Fixing issue setting newtmgr serial connection

Removed:
* Finished TODOs

### [0.1.12]

Added:
* Load and monitor functionality 
* Flash and monitor functionality as well

Changed:
* For quickPick, enabling ignoreFocusOut otherwise we get failures
* Canceling running tasks for the flash/load commands
* Saving of port either determined by a monitor command or newtmgr (should be the same port no matter what)

### [0.1.11]

Added:
* Created monitor command for monitoring serial

Changed:
* Brought out getPort and getBaud so they can be re-used

### [0.1.10]

### Removed:

* Use of serialports npm package

### Added:

* Additional download and use of zephyr-tools-monitor

## [0.1.9]

### Changed:

* west flash uses nrfjprog by default
* adding a note to investigate using probe-rs to avoid installing j-link and nrfjprog
* Success message using showInformationMessage
* Changing success message for reset function

## [0.1.8]

### Added:

* Setup for `newtmgr` 
* Loading via `newtmgr` to devices with bootloader

## [0.1.7]

### Changed:

* `west flash` with `--softreset --erase` flags

## [0.1.6]

### Changed:

* Blank `git` URL handling for initialization command 
* Updating Readme checklist

## [0.1.5]

### Changed:

* Downloading newtmgr
* Commented out updating of PATH env variable
* Making sure that PATH doesn't get completely clobbered
* Fixing path check for Init (use fsPath instead)
* Updated changelog


## [0.1.4]

### Changed:

* Wrapped ensurepip in conditional to ignore on Linux
* Manifest for Linux is populated
* Updated Ubuntu requirements
* Added other extensions as a pack
* Setup cancelable turning off since it wont cancel anything.. 😅

## [0.1.3]

### Added:

* Simple get workspace root function
* Activation event at startup for init
* Creation of PendingTask that is run on startup (useful for changing workspace)

### Changed:

* Move callback within the success area of Task Manager.
* Init function separate now from task
* Checking for invalid urls for init

## [0.1.2]

### Changed:

* shellOptions to include cwd

### Added:

* Actually calling callback on success
* isInit for project to make sure requirements.txt is processed first.

## [0.1.0]

### Added:
* Notes for deps on Windows and Linux
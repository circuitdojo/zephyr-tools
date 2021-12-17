# Change Log

All notable changes to the "zephyr-tools" extension will be documented in this file.

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
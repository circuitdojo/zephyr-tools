# Zephyr Tools for VSCode

Circuit Dojo designed Zephyr Tools to make getting started with Zephyr a snap. More information and features coming.

## Features

- Multi-plaftorm support
- Setup Zephyr dependencies and ARM toolchain
- Initialize remote and local repositories
- Build and flash your code
- Bring your own Zephyr modules

## Requirements

### Mac

Requires `git` and `python3` to be installed. The easiest way to do that is with [Homebrew](https://brew.sh).

```
> brew install git python3
```

### Windows

Requires `git` and `python` to be installed.

- Download and install `git` from here: https://git-scm.com/download/win
- Download and install `python` from here: https://www.python.org/ftp/python/3.9.9/python-3.9.9-amd64.exe

### Linux

Requires `git` and `python` to be installed.

Use your distro's package manager of choice to install. 

For example on Ubuntu:

```
sudo apt install git python3 python3-pip
```

## TODO List

Here are some of the tasks needed to be completed for this project:

- [ ] Creating a new project from scratch/template
- [ ] CI/CD
- [ ] Init check for branchs and prompts which to download
- [ ] Using probe-rs for programming (cross platform)
- [x] Flashing via `west flash`
- [x] Flashing via `newtmgr` or `mcumgr`
- [x] Download and add `newtmgr` to path 
- [x] Linux support tested

## Release Notes

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

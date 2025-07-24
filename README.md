# Zephyr Tools for VSCode

Circuit Dojo designed Zephyr Tools to make getting started with Zephyr a snap. More information and features coming.

## Features

- Multi-plaftorm support
- Setup Zephyr dependencies and ARM toolchain
- Initialize remote and local repositories
- Build and flash your code
- Bring your own Zephyr modules

## Recommended Extensions

For the best development experience with Zephyr Tools, we recommend installing these VS Code extensions:

- **C/C++ Extension Pack** (`ms-vscode.cpptools`) - Provides IntelliSense, debugging, and code browsing for C/C++ code
- **nRF DeviceTree** (`nordic-semiconductor.nrf-devicetree`) - Syntax highlighting and IntelliSense for DeviceTree files
- **nRF Kconfig** (`nordic-semiconductor.nrf-kconfig`) - Syntax highlighting and IntelliSense for Kconfig files

These extensions will be automatically suggested when you open a workspace with Zephyr Tools. You can install them individually from the Extensions marketplace or all at once when prompted.

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
sudo apt install git python3 python3-pip python3-venv
```

## TODO List

Here are some of the tasks needed to be completed for this project:

- [x] Project based config file (editable persistent configurations)
- [ ] Allow for different manfest names (if applicable)
- [x] Disable auto logging to file (settings/configuration)
- [ ] Setting common parameters in confguration
- [x] Reinstall dependencies if manifest differs from what's installed
- [x] Creating a new project from scratch/template
- [ ] CI/CD
- [x] Using probe-rs for programming (cross platform)
- [x] Cache boards for change boards
- [x] Store board in project
- [ ] Delay after reset command

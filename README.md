# Zephyr Tools for VS Code

Circuit Dojo designed Zephyr Tools to make getting started with Zephyr a snap. This extension simplifies working with the Zephyr RTOS by providing project management, build automation, flashing, monitoring, and hardware integration capabilities.

## Features

### Core Functionality
- **Multi-platform support** - Works on Windows, macOS, and Linux
- **Automated setup** - Install Zephyr dependencies, SDK, and toolchains with one command
- **Project management** - Create new projects, initialize repositories, and manage existing ones
- **Build system integration** - Build, build pristine, and clean your projects
- **Hardware support** - Flash devices, monitor serial output, and manage hardware configurations
- **Debugging** - Create debug configurations and launch debugging sessions

### Project Management
- Create new Zephyr projects from templates (vanilla Zephyr, nRF Connect SDK, NFED)
- Initialize local and remote repositories
- Change board targets and project configurations
- Support for custom Zephyr modules
- Sysbuild support for complex applications

### Build Features
- Standard and pristine builds
- Clean build artifacts
- Build status in VS Code status bar
- Build output in dedicated output channel
- Support for CMake and Ninja build systems

### Hardware Integration
- **Multiple flash methods**:
  - Standard West flash
  - probe-rs for cross-platform flashing
  - newtmgr for MCUboot operations
- **Serial monitoring**:
  - Configurable baud rates
  - Save logs to file
  - Toggle logging on/off
- **Hardware detection**:
  - Auto-detect serial ports
  - Multi-probe support with selection UI
  - probe-rs chip detection

### Developer Tools
- Open Zephyr-configured terminal
- View and manage build assets in sidebar
- Environment path management
- Python virtual environment per workspace
- VS Code task integration for long-running operations

### UI Features
- **Custom sidebar** with project information and build assets
- **Status bar items** showing current board and project
- **Command palette** integration with 25+ commands
- **Webview** for enhanced project management

## Recommended Extensions

For the best development experience with Zephyr Tools, we recommend installing these VS Code extensions:

- **C/C++ Extension Pack** (`ms-vscode.cpptools`) - Provides IntelliSense, debugging, and code browsing for C/C++ code
- **nRF DeviceTree** (`nordic-semiconductor.nrf-devicetree`) - Syntax highlighting and IntelliSense for DeviceTree files
- **nRF Kconfig** (`nordic-semiconductor.nrf-kconfig`) - Syntax highlighting and IntelliSense for Kconfig files
- **Probe-rs Debugger** (`probe-rs.probe-rs-debugger`) - Debug embedded applications using probe-rs

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

## Getting Started

1. **Install the extension** from the VS Code marketplace
2. **Run setup**: Open Command Palette (`Cmd/Ctrl+Shift+P`) and run `Zephyr Tools: Setup`
3. **Create a project**: Run `Zephyr Tools: Create Project` or initialize an existing repository with `Zephyr Tools: Init Repo`
4. **Build your project**: Run `Zephyr Tools: Build` or click the build button in the status bar
5. **Flash and monitor**: Run `Zephyr Tools: Flash and Monitor` to deploy and debug your application

## Configuration

Zephyr Tools provides several configuration options accessible through VS Code settings:

### Path Configuration
- `zephyr-tools.paths.toolsDirectory` - Custom path to Zephyr tools directory (default: ~/.zephyr-tools/)
- `zephyr-tools.paths.pythonExecutable` - Custom Python executable path
- `zephyr-tools.paths.zephyrBase` - Custom ZEPHYR_BASE path
- `zephyr-tools.paths.westExecutable` - Custom West executable path

### Hardware Configuration
- `zephyr-tools.probeRs.chipName` - Chip name for probe-rs operations
- `zephyr-tools.probeRs.probeId` - Specific probe ID to use
- `zephyr-tools.probeRs.preverify` - Verify memory before flashing
- `zephyr-tools.probeRs.verify` - Verify memory after flashing

### Serial Configuration
- `zephyr-tools.serial.port` - Default serial port for monitoring
- `zephyr-tools.serial.saveLogsToFile` - Enable saving serial logs to file
- `zephyr-tools.newtmgr.baudRate` - Baud rate for newtmgr connections

## Project Structure

Zephyr Tools projects use the following structure:
```
your-project/
├── .zephyr-tools/
│   └── project.json    # Project configuration
├── .venv/              # Python virtual environment
├── target/             # Build artifacts
│   └── build/
│       └── <board>/    # Board-specific build output
├── CMakeLists.txt      # Project CMake configuration
├── prj.conf            # Kconfig configuration
└── src/                # Source code
    └── main.c
```

## Troubleshooting

### Common Issues

1. **Setup fails**: Ensure you have git and python3 installed as per the requirements
2. **Build errors**: Check that your board is supported and project configuration is correct
3. **Flash failures**: Verify your hardware is connected and the correct runner is selected
4. **Serial monitor issues**: Check port permissions and that no other application is using the port

### Logs and Debugging

- View extension logs in the Output panel under "Zephyr Tools"
- Build output appears in "Zephyr Tools - Build"
- Serial output appears in "Zephyr Tools - Serial"

## Support

For issues, feature requests, or contributions, please visit the [GitHub repository](https://github.com/circuitdojo/zephyr-tools-vscode).
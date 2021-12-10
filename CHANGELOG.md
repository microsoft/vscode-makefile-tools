# What's New?

## 0.3.1
Bug fixes:
- Honor the "terminal.integrated.automationShell" setting when spawning make for configure. [#233](https://github.com/microsoft/vscode-makefile-tools/issues/233)
- Remove the "build" button icon from other UIs than the main Makefile Tools panel. [#245](https://github.com/microsoft/vscode-makefile-tools/issues/245)
- The build task fails for projects using -f or -C (makefile not in root) because of quoting. [#249](https://github.com/microsoft/vscode-makefile-tools/issues/249)
- Fix activation for makefiles below the root. [#248](https://github.com/microsoft/vscode-makefile-tools/issues/248)

## 0.3.0
Improvements:
- Generate compile commands. [#104](https://github.com/microsoft/vscode-makefile-tools/issues/104) [@rapgenic](https://github.com/rapgenic)
- Support for problem matchers. [#7](https://github.com/microsoft/vscode-makefile-tools/issues/7)

Bug fixes:
- Fix wrong extension activation for non makefile projects. [#181](https://github.com/microsoft/vscode-makefile-tools/issues/181)
- Align defaults for C/C++ standard and IntelliSense mode to expectations in CMakeTools/CppTools. [#119](https://github.com/microsoft/vscode-makefile-tools/issues/119)
- Fix parsing source file paths when in quotes. [#203](https://github.com/microsoft/vscode-makefile-tools/issues/203)
- Don't show the Makefile Tools output channel automatically. [#115](https://github.com/microsoft/vscode-makefile-tools/issues/115)
- Improve parsing of more complicated scenarios of quoting and escaping for -D and -I. [#169](https://github.com/microsoft/vscode-makefile-tools/issues/169)
- Pass pre-configure environment to the build task. [PR #104](https://github.com/microsoft/vscode-makefile-tools/pull/239)
- Complete the parsing input text with what is outputted on stderr as well, besides stdout. [PR #238](https://github.com/microsoft/vscode-makefile-tools/pull/238)
- Fix paths processing for non-windows tools run on windows outside MinGW/CygWin environments. [#219](https://github.com/microsoft/vscode-makefile-tools/issues/219)

## 0.2.2
- Fix pre-configure script invocation, broken on Linux starting with Makefile Tools 0.2.1. [#170](https://github.com/microsoft/vscode-makefile-tools/issues/170) [@avrahamshukron](https://github.com/avrahamshukron)

## 0.2.1
- Add new makeDirectory setting (global and per configuration level) as an extra location to search for the makefile and to generate "make -C".
- Fix the clean re-build for a project that has a default (empty "") build target.
- Various bug fixes regarding:
    - launch-targets/launch-configurations
    - quoting of files/arguments sent to shell when running executables or scripts
- Force English when running executables or scripts that need to parse English words from the execution output.
- Show the output channel only when something errors.
- Support compilers run through ccache.
- Use "shell" arguments convention when parsing compilerArgs for CppTools.
- Don't append the ".exe" extension suffix if the binary file already has an extension in the given path.

## 0.2.0
- Various bug fixes for MSYS/MinGW related to paths, strings, regular expressions and file system APIs
- Fix source file paths in the backtick pattern
- Fix cases of not finding an existing MAKE executable in the path
- Add new settings: makefile.saveBeforeBuild and makefile.buildBeforeLaunch
- Rename launch commands:
    - makefile.launchTargetPath --> makefile.getLaunchTargetPath
    - makefile.launchTargetDirectory --> makefile.getLaunchTargetDirectory
    - makefile.launchTargetFileName --> makefile.getLaunchTargetFileName
    - makefile.launchTargetArgs --> makefile.getLaunchTargetArgs
    - makefile.launchTargetArgsConcat --> makefile.getLaunchTargetArgsConcat
- Add new launch commands, that trigger a build when makefile.buildBeforeLaunch allows:
    - makefile.launchTargetPath
    - makefile.launchTargetFileName

## 0.1.3
- Activate in the presence of GNUmakefile in the root as well.
- Add ignoreDirectoryCommands setting for when the extension should analyze only the output of make -C
  and not commands written in plain, like cd, pushd, popd.
- Additional support for CCache, Libtool
- Initial support for common scenarios of backquotes in compiler/linker command lines.
- Fix bug when a .la library is considered executable for debug/launch.
- Change CWD for binary targets from the project root into the location where they are built.
- Repo compilation script changes
- Make sure the debug output is in focus after every debug command.

## 0.1.2
- Support suffixes/prefixes specific for version and cross compilers.
- Add the possibility to list only the makefile targets marked as .PHONY.
- Various bug fixes.

## 0.1.1

- Addressed feedback from 0.1
- Replaced the strategy for determining build targets and removed the giant log.
- Added settings for where configuration logs can be stored.
- Added project configuration caching to speed up subsequent session loads.

## 0.1

- Initial release
- Support for IntelliSense, Build, Debug, Run configurations.
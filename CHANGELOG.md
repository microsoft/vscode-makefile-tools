# Change Log

All notable changes to the "vscode-makefile-tools" extension will be documented in this file.

## 0.1.4
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
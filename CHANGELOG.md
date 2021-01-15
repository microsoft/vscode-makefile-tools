# Change Log

All notable changes to the "vscode-makefile-tools" extension will be documented in this file.

## 0.1.3
- Activate in the presence of GNUmakefile in the root as well.
- Add ignoreDirectoryCommands setting for when the extension should analyze only the output of make -C
  and not commands written in plain, like cd, pushd, popd.
- Fix configuration item bug when there are special characters (+, ", etc) in the source file path.
- Show the ouput channel at creation time and when operations begin, as opposed o every written message.
- Fix various bugs with incorrect return codes for preconfigure and configure operations.
- Fix various parsing bugs related to: 
    - build targets
    - parsing compilers, linkers and binary invocations from command lines
    - lazy versus greedy
    - exe extension for windows
    - inner and outer quotes
    - $ sign in various relevant compiler/linker arguments
    - escaped characters in the compilers/linkers command lines
- Additional support for CCache, Libtool
- Hacky (temporary) support for common scenarios of backquotes in compiler/linker command lines.
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
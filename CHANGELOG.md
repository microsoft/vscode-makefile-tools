# What's New?

## 0.11

Improvements:

- More wisely pass the modified environment variables, if present, from the pre/post-configure scripts to tasks and debugging options. [#540](https://github.com/microsoft/vscode-makefile-tools/issues/540), [#493](https://github.com/microsoft/vscode-makefile-tools/issues/493), [#554](https://github.com/microsoft/vscode-makefile-tools/issues/554)

Bug Fixes:

- Ensure that we append line endings, which fixes a recent regression. [#641](https://github.com/microsoft/vscode-makefile-tools/issues/641)
- Ensure we handle parenthesis without their partner correctly. [#543](https://github.com/microsoft/vscode-makefile-tools/issues/543)

Improvements:

- Update signing to support VSCode extension signing. [#647](https://github.com/microsoft/vscode-makefile-tools/pull/647)

## 0.10.26

Bug Fixes:

- Fix issue where the Makefile Extension was blocked on answering the "Would you like to Configure..." pop-up. [#639](https://github.com/microsoft/vscode-makefile-tools/issues/639)

## 0.10.25

Improvements:

- Remove dry-run pop-up and improve initial configureOnOpen experience. [#573](https://github.com/microsoft/vscode-makefile-tools/pull/573)

Bug Fixes:

- Fix issue where simply clicking on tree item was opening launch target selection. [#588](https://github.com/microsoft/vscode-makefile-tools/issues/588)
- Fix issue where selecting "Default" from the configuration drop down doesn't update Makefile Project Outline [#585](https://github.com/microsoft/vscode-makefile-tools/issues/585)
- Fix issue where CHS and CHT wasn't being localized on Linux. [#609](https://github.com/microsoft/vscode-makefile-tools/issues/609)
- Ensure that tooltips for the project outline are reasonable and consistent. [#600](https://github.com/microsoft/vscode-makefile-tools/issues/600)
- Fix issue where clicking out of quick pick wasn't closing quick pick. [#604](https://github.com/microsoft/vscode-makefile-tools/issues/604)
- Fix issue where line endings were being added in the output which broke long compile commands from output of make.exe. [#545](https://github.com/microsoft/vscode-makefile-tools/issues/545)

## 0.9

Bug Fixes:

- Fix an issue with XDG_RUNTIME_DIR where we tried to reference the directory, but it didn't exist. [#553](https://github.com/microsoft/vscode-makefile-tools/pull/555)

Improvements:

- Add telemetry about how many users are hitting the dry-run warning and how many users are stopping the dry-run process due to it. [#565](https://github.com/microsoft/vscode-makefile-tools/pull/565)
- Remove preprocessed regular expressions to reduce time. [#580](https://github.com/microsoft/vscode-makefile-tools/pull/580)

## 0.8

Bug Fixes:

- Fix a bug where the first argument for pre/post-configure args didn't have the proper spacing in front of it [PR #530](https://github.com/microsoft/vscode-makefile-tools/pull/530)
- Fix a bug where we weren't handling pre/post-configure args for the non-windows scenarios. [#531](https://github.com/microsoft/vscode-makefile-tools/issues/531)
- Fix a bug where we were checking the wrong character of the architecture. [#499](https://github.com/microsoft/vscode-makefile-tools/issues/499)

Improvements:

- Add support for a post configure script. [#391](https://github.com/microsoft/vscode-makefile-tools/issues/391)
- Add support for post-configure and pre-configure script arguments, both globally and per configuration. [#151](https://github.com/microsoft/vscode-makefile-tools/issues/151)
- Honor workspace trust in VS Code and warn about code being run during dry-run. [#514](https://github.com/microsoft/vscode-makefile-tools/pull/514)
- Ship the parseCompilerArgs script with the extension to avoid race conditions. [#516](https://github.com/microsoft/vscode-makefile-tools/issues/516), [#475](https://github.com/microsoft/vscode-makefile-tools/issues/475)
- Avoid relativizing paths in the project outline. [#519](https://github.com/microsoft/vscode-makefile-tools/pull/519) [@drok sponsored by @Mergesium](https://github.com/drok)

## 0.7.0

Improvements:

- Variable expansion support in settings. [#25](https://github.com/microsoft/vscode-makefile-tools/issues/25)
- Improve the UI user experience when key pieces (makefile, make, build.log) are not found. [#394](https://github.com/microsoft/vscode-makefile-tools/issues/394)
- Add support for C++23 [#433](https://github.com/microsoft/vscode-makefile-tools/issues/433)
- Smart path handling and flexibility in required path structure/default for various path settings (makefilePath, miDebuggerPath). [#341](https://github.com/microsoft/vscode-makefile-tools/issues/341) [#365](https://github.com/microsoft/vscode-makefile-tools/issues/365)

Bug fixes:

- Fix case sensitivity on Windows. [#416](https://github.com/microsoft/vscode-makefile-tools/issues/416)
- Ensure paths with `&` are quoted. [#417](https://github.com/microsoft/vscode-makefile-tools/issues/417)
- Avoid regexp hang when processing strings like "-------------". [#106](https://github.com/microsoft/vscode-makefile-tools/issues/106)
- Ensure that we don't write into user settings when a value has been specified by the user. [#356](https://github.com/microsoft/vscode-makefile-tools/pull/356)
- Fix regex parsing for targets. [#441](https://github.com/microsoft/vscode-makefile-tools/issues/441) [@nick-hebi](https://github.com/nick-hebi)
- Don't configure when there is no makefile entrypoint. Don't cache when provider data is empty. [#449](https://github.com/microsoft/vscode-makefile-tools/issues/449)
- Log about telemetry only when it is enabled in VSCode. [#446](https://github.com/microsoft/vscode-makefile-tools/issues/446)

## 0.6.0

Bug fixes:

- Do not write to the user's workspace folders by default. [#329](https://github.com/microsoft/vscode-makefile-tools/issues/329)
- Do not change the value of makefile.extensionOutputFolder in the user's workspace/folder settings. [#331](https://github.com/microsoft/vscode-makefile-tools/issues/331)

## 0.5.0

Improvements:

- Implement the ability to make various extension features optional and hide them from the UI. Initial examples: debugging an executable target and/or running it in terminal. [#290](https://github.com/microsoft/vscode-makefile-tools/issues/290) [@jdmchp](https://github.com/jdmchp)

Bug fixes:

- Fix telemetry bug related to object settings. [PR #309](https://github.com/microsoft/vscode-makefile-tools/pull/309)
- Fix localize initialization logistics in launch source code. [#305](https://github.com/microsoft/vscode-makefile-tools/issues/305)
- Fix regular expression used in processing the build targets ouf of the dryrun log. [PR #307](https://github.com/microsoft/vscode-makefile-tools/pull/307) [@DepthDeluxe](https://github.com/DepthDeluxe)

## 0.4.0

Improvements:

- Localization support for all strings used in titles and descriptions of settings, commands and various UI elements (popups, trees, buttons...).
  The messages in the output channel are not yet localized.

Bug fixes:

- Fix makePath: add "make" when only a directory path was specified. [#237](https://github.com/microsoft/vscode-makefile-tools/issues/237)
- Activation problem when buildLog is used. Add missing linker. Fix bug when calculating binary targets. Use non deprecated VSCode terminal setting. [PR #256](https://github.com/microsoft/vscode-makefile-tools/pull/256)
- Keep the pre-configure environment when sending the launch target to the terminal or the debugger. [#295](https://github.com/microsoft/vscode-makefile-tools/issues/295)

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

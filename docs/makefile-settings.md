# Makefile Settings

All settings for the Makefile Tools extension can be configured in your `settings.json` under the `makefile.*` namespace.

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `makefile.configurations` | array | `[]` | The user defined makefile configurations. Each configuration is an object with optional properties: `name`, `makefilePath`, `makePath`, `makeDirectory`, `makeArgs` (default `[]`), `problemMatchers` (default `["$gcc", "$msvc"]`), `buildLog`, `preConfigureArgs` (default `[]`), `postConfigureArgs` (default `[]`). |
| `makefile.defaultLaunchConfiguration` | object | `null` | Various global debugger settings. Properties: `MIMode` (`"gdb"` or `"lldb"`), `miDebuggerPath`, `stopAtEntry` (default `false`), `symbolSearchPath`. |
| `makefile.launchConfigurations` | array | `[]` | The user defined launch (debug/run) configurations. Each configuration is an object with optional properties: `name`, `description`, `binaryPath`, `binaryArgs` (default `[]`), `cwd`, `MIMode` (`"gdb"` or `"lldb"`), `miDebuggerPath`, `stopAtEntry` (default `false`), `symbolSearchPath`. |
| `makefile.loggingLevel` | string | `"Normal"` | The logging level for the Makefile Tools extension. Possible values: `"Normal"`, `"Verbose"`, `"Debug"`. |
| `makefile.makePath` | string | `"make"` | The path to the make tool used by the extension. |
| `makefile.makeDirectory` | string | *undefined* | The folder path to be passed to make via the `-C` switch. |
| `makefile.makefilePath` | string | *undefined* | The path to the makefile of the project. |
| `makefile.buildLog` | string | `null` | The path to the build log that is read to bypass a dry-run. |
| `makefile.extensionOutputFolder` | string | `""` | The path to various output files produced by the extension. Defaults to the VS Code workspace storage location. |
| `makefile.extensionLog` | string | `""` | The path to an output file storing all content from the Makefile output channel. Defaults to the value of the `makefile.extensionOutputFolder` setting. |
| `makefile.configurationCachePath` | string | `""` | The path to a cache file storing the output of the last dry-run make command. When unset, a file named `configurationCache.log` is stored at the path specified by `makefile.extensionOutputFolder`. |
| `makefile.dryrunSwitches` | array | `["--always-make", "--keep-going", "--print-directory"]` | Arguments to pass to the dry-run make invocation. |
| `makefile.additionalCompilerNames` | array | `[]` | Names of compiler tools to be added to the extension known list. |
| `makefile.excludeCompilerNames` | array | `[]` | Names of compiler tools to be excluded from the extension known list. |
| `makefile.safeCommands` | array | `[]` | Commands that are safe to perform command substitution with. |
| `makefile.configureOnOpen` | boolean | `null` | Automatically configure Makefile project directories when they are opened. |
| `makefile.configureOnEdit` | boolean | `true` | Automatically configure Makefile project directories when any relevant makefiles and/or settings are changed. |
| `makefile.configureAfterCommand` | boolean | `true` | Automatically configure Makefile project directories after relevant operations, like changing build configuration or makefile target. |
| `makefile.cleanConfigureOnConfigurationChange` | boolean | `true` | When true (default), always run Clean Configure (which uses `--always-make`) when switching build configurations. When false, the `configureAfterCommand` setting determines if regular Configure runs. Clean Configure produces a complete compilation database, while regular Configure only includes out-of-date targets. |
| `makefile.preConfigureScript` | string | `null` | The path to the script that needs to be run at least once before configure. |
| `makefile.preConfigureArgs` | array | `[]` | Arguments to pass to the pre-configure script. |
| `makefile.postConfigureScript` | string | `null` | The path to the script that needs to be run at least once after configure. |
| `makefile.postConfigureArgs` | array | `[]` | Arguments to pass to the post-configure script. |
| `makefile.alwaysPreConfigure` | boolean | `false` | Always run the pre-configure script before configure. |
| `makefile.alwaysPostConfigure` | boolean | `false` | Always run the post-configure script after configure. |
| `makefile.ignoreDirectoryCommands` | boolean | `true` | Don't analyze directory changing commands like cd, push, pop. |
| `makefile.phonyOnlyTargets` | boolean | `false` | Display only the phony targets. |
| `makefile.saveBeforeBuildOrConfigure` | boolean | `true` | Save opened files before building or configuring. |
| `makefile.buildBeforeLaunch` | boolean | `true` | Build the current target before launch (debug/run). |
| `makefile.buildOnSave` | boolean | `false` | Build the current target when a file in the workspace is saved. |
| `makefile.runOnSave` | boolean | `false` | Build and run the current target when a file in the workspace is saved. |
| `makefile.clearOutputBeforeBuild` | boolean | `true` | Clear the output channel at the beginning of a build. |
| `makefile.compileCommandsPath` | string | `null` | The path to the compilation database file. |
| `makefile.panel.visibility` | object | `null` | Control the visibility of items in the Makefile Project Outline panel. Properties: `debug` (default `true`), `run` (default `true`), `buildCleanTarget` (default `false`). |

## Command Substitution

Makefile Tools can expand VS Code commands when invoked in `launch.json` and `tasks.json` with this syntax: `${command:makefile.launchTargetPath}`.

Supported commands for substitution:

|command|substitution|
|-------|------------|
|`makefile.getLaunchTargetPath`|The full path to the target executable, including the filename. The existence of the target is not validated.|
|`makefile.getLaunchTargetDirectory`|The full path to the target executable's directory. The existence of the directory is not validated.|
|`makefile.getLaunchTargetFileName`|The name of the target executable file without any path or extension information. The existence of the target is not validated.|
|`makefile.getLaunchTargetArgs`|A string array describing the arguments of the current launch target.|
|`makefile.getLaunchTargetArgsConcat`|A string describing the arguments of the current launch target concatenated in a single string and separated by space.|
|`makefile.launchTargetPath`|The full path to the target executable, including the filename. If `makefile.buildBeforeLaunch` is true, invoking this substitution will also start a build.|
|`makefile.launchTargetFileName`|The name of the target executable file without any path or extension information. If `makefile.buildBeforeLaunch` is true, invoking this substitution will also start a build.|
|`makefile.makeBaseDirectory`|The folder where `make` will be starting from: passed with -C or otherwise the workspace folder.|

## Variable Substitution

Makefile Tools supports the usage of macros in your `settings.json` as well.

Supported macros for substitution:

|macro|expands to|
|-----|----------|
|`${workspaceFolder}`| The path to your workspace folder (i.e. `C:/Users/Projects/MyProject`). |
|`${workspaceFolderBasename}`| The name of your workspace folder (i.e. `MyProject`). |
|`${userHome}`| The path to the user's home folder (i.e. `C:/Users`). |
|`${env:ENVIRONMENT_VARIABLE}`| A given `ENVIRONMENT_VARIABLE` for the current development environment. |
|`${command:ANY_EXTENSION_SCOPE.ANY_COMMAND_ID}` | The expanded value for any command for a given extension in VS Code (i.e. any of the ones listed above, like `command:makefile.getLaunchTargetPath` expands to the launch target path)|
|`${config:ANY_EXTENSION_SCOPE.ANY_SETTING_ID}` | The expanded value for any setting associated with another given extension in VS Code (i.e. `{config:C_Cpp.default.compileCommands}` expands to the path to your `compile_commands.json`) |
|`${configuration}`| The active configuration of your makefile project (i.e. `debug_x86`) |
|`${command:makefile.getConfiguration}`| The active configuration of your makefile project (i.e. `debug_x86`) |
|`${buildTarget}`| The active build target of your makefile target {i.e. `target.exe`} |
|`${command:makefile.getBuildTarget}`| The active build target of your makefile target {i.e. `target.exe`} |


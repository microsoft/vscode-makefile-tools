# Command substitution

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

# Variable substitution

Makefile Tools supports the usage of macros in your `settings.json` as well.

Supported macros for substitution:

|macro|expands to|
|-----|----------|
|`${workspaceFolder}`| The path to your workspace folder (i.e. `C:/Users/Projects/MyProject`). |
|`${workspaceFolderBasename}`| The name of your workspace folder (i.e. `MyProject`). |
|`${userHome}`| The path to the user's home folder (i.e. `C:/Users`). |
|`${env:ENVIRONMENT_VARIABLE}`| A given `EVNIRONMENT_VARIBLE` for the current development environment. | 
|`${command:ANY_EXTENSION_SCOPE.ANY_COMMAND_ID}` | The expanded value for any command for a given extension in VS Code (i.e. any of the ones listed above, like `command:makefile.getLaunchTargetPath` expands to the launch target path)|
|`${config:ANY_EXTENSION_SCOPE.ANY_SETTING_ID}` | The expanded value for any setting associated with another given extension in VS Code (i.e. `{config:C_Cpp.default.compileCommands}` expands to the path to your `compile_commands.json`) |
|`${configuration}`| The active configuration of your makefile project (i.e. `debug_x86`) |
|`${command:makefile.getConfiguration}`| The active configuration of your makefile project (i.e. `debug_x86`) |
|`${buildTarget}`| The active build target of your makefile target {i.e. `target.exe`} |
|`${command:makefile.getBuildTarget}`| The active build target of your makefile target {i.e. `target.exe`} |
 

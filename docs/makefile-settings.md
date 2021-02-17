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
|`makefile.launchTargetPath`|The full path to the target executable, including the filename. If `makefile.buildBeforeRun` is true, invoking this substitution will also start a build.|
|`makefile.launchTargetFileName`|The name of the target executable file without any path or extension information. If `makefile.buildBeforeRun` is true, invoking this substitution will also start a build.|

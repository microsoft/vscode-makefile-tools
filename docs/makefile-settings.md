# Configure Makefile Tools settings

Makefile Tools supports a variety of settings that can be set at the user, or workspace, level via VSCode's `settings.json` file. This topic covers the available options and how they are used.

## Makefile settings

There is no variable substitution available for the Makefile Tools settings and we plan to implement such support in a future release.

### Command substitution

Makefile Tools can expand VS Code commands. For example, you can expand the path to the launch target by using the syntax `${command:makefile.launchTargetPath}`

Be careful with long-running commands because it isn't specified when, or how many times, Makefile Tools will execute a command for a given expansion.

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

## Next steps

- Learn about [user vs. workspace settings](https://code.visualstudio.com/docs/getstarted/settings)
- Explore the [Makefile Tools documentation](../README.md)

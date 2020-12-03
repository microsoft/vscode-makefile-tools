# VS Code Makefile Tools - early preview

This extension provides IntelliSense configurations to the VS Code C/C++ Extension for Makefile projects.
It also provides convenient commands to build, debug, and run your targets.

# Getting Started

### Installation
To install the extension, go to the [Actions](https://github.com/microsoft/vscode-makefile-tools/actions)
tab or the [Releases](https://github.com/microsoft/vscode-makefile-tools/releases) page and download the
most recent build of the VSIX.  Once downloaded, use the "Install from VSIX..." command in VS Code to select
and install the extension.

### Activating the extension
The extension will activate when it finds a Makefile in your `${workspaceFolder}`. If your Makefile does not
reside in the root of your folder, use the `makefile.makefilePath` setting to instruct the extension where to
find it.
> Note: the extension will not activate automatically if your Makefile is not in the root of your workspace
folder. If this is the case, you will need to manually activate it by running one of the `Makefile:` commands
from VS Code's command palette.

### Configuring your project
By default, the extension will attempt to use a `make` program that resides within your $PATH to configure
the project.  If you use a different flavor of the make tool or if it is not in your $PATH, use the
`makefile.makePath` setting to instruct the extension where to find it.

Now, you are ready to configure your project. If you normally just run `make` in the terminal to
configure/build your project, you shouldn't need to do anything else at this point besides accept the prompt
from cpptools to allow this extension to configure IntelliSense:

![image](https://user-images.githubusercontent.com/12818240/94731434-9d1e3380-0319-11eb-98c4-cb80218b1b8b.png)

If you don't see that message, or you accidentally dismissed it, you can grant Makefile Tools permission to
configure IntelliSense by running the `C/C++: Change Configuration Provider...` command and selecting Makefile
Tools from the list.

If you regularly pass additional arguments to `make`, you should use the `makefile.configurations` setting
to create a configuration object and specify the arguments to pass to `make` with the `makeArgs` property.
There are other options you can configure in this object as well. If you configure `make` in multiple
different ways, you can create multiple configuration objects with different arguments. Just make sure to
give your configurations a unique `name` so that you can tell them apart.

### Building targets

To build a target, run the `Makefile: Set the target to be built by make` command (default target is "all")
and then run the `Makefile: Build the current target`.  There are also convenience commands to build ALL,
build clean, etc. without having to change your active build target.

### Debugging and running targets

To Debug or run a target, run the `Makefile: Set the make launch configuration` command and select the target
you want to debug or run. If a configuration for that target has not already been added to the
`makefile.launchConfigurations` setting, then one will be added for you at this time.  Then run the 
`Makefile: Debug the selected binary target` or `Makefile: Run the selected binary target in the terminal` 
command to start debugging or running the target without a debugger attached.

If you need to pass additional arguments to your targets, update the `makefile.launchConfigurations` by adding
the `binaryArgs` property to the configuration.

# Feedback and Suggestions

Let us know what you think! If you are having trouble with the extension, please
[open an issue](https://github.com/microsoft/vscode-makefile-tools/issues/new).

Since we don't have any other feedback channels available yet, you can also open an issue to report what you
like about the extension or which features are the most useful to you.

# Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Data and telemetry

This extension collects usage data and sends it to Microsoft to help improve our products and services. Collection of telemetry is controlled via the same setting provided by Visual Studio Code: `"telemetry.enableTelemetry"`. Read our [privacy statement](https://privacy.microsoft.com/en-us/privacystatement) to learn more.
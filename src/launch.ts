// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Launch support: debug and run in terminal

import * as configuration from './configuration';
import * as extension from './extension';
import * as logger from './logger';
import * as make from './make';
import * as path from 'path';
import * as telemetry from './telemetry';
import * as util from './util';
import * as vscode from 'vscode';

export enum LaunchStatuses {
    success = "success",
    blocked = "blocked by (pre)configure or build",
    noLaunchConfigurationSet = "no launch configuration set by the user",
    launchTargetsListEmpty = "launch targets list empty"
}

let launcher: Launcher;

export class Launcher implements vscode.Disposable {
    // Command property accessible from launch.json:
    // the full path of the target binary currently set for launch
    public launchTargetPath(): string {
        let launchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.binaryPath;
        } else {
            return "";
        }
    }

    // Command property accessible from launch.json:
    // the full path from where the target binary is to be launched
    public launchTargetDirectory(): string {
        let launchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.cwd;
        } else {
            return vscode.workspace.rootPath || "";
        }
    }

    // Command property accessible from launch.json:
    // the arguments sent to the target binary, returned as array of string
    // This is used by the debug/terminal VS Code APIs.
    public launchTargetArgs(): string[] {
        let launchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.binaryArgs;
        } else {
            return [];
        }
    }

    // Command property accessible from launch.json:
    // the arguments sent to the target binary, returned as one simple string
    // This is an alternative to define the arguments in launch.json,
    // since the string array syntax is not working.
    // This is not a perfect solution, it all depends on how the main entry point
    // is parsing its given arguments.
    // Example: for [CWD>tool arg1 arg2 arg3], the tool will receive
    // 2 arguments: tool and "arg1 arg2 arg3"
    // As opposed to the above case when the tool will receive
    // 4 arguments: tool, arg1, arg2, arg3
    // TODO: investigate how we can define string array arguments
    // for the target binary in launch.json
    public launchTargetArgsConcat(): string {
        return this.launchTargetArgs().join(" ");
    }

    // Invoke a VS Code debugging session passing it all the information
    // from the current launch configuration.
    // Debugger (imperfect) guess logic:
    //    - VS for msvc toolset, lldb for clang toolset, gdb for anything else.
    //    - debugger path is assumed to be the same as the compiler path.
    // Exceptions for miMode:
    //    - if the above logic results in a debugger that is missing, try the other one.
    //      This is needed either because the system might not be equipped
    //      with the preffered debugger that corresponds to the toolset in use,
    //      but also because there might be a compiler alias that is not properly identified
    //      (example: "cc" alias that points to clang but is not identified as clang,
    //       therefore requesting a gdb debugger which may be missing
    //       because there is no gcc toolset installed).
    //       TODO: implement proper detection of aliases and their commands.
    // Exceptions for miDebuggerPath:
    //    - for MacOS, point to the lldb-mi debugger that is installed by CppTools
    //    - if CppTools extension is not installed, intentionally do not provide a miDebuggerPath On MAC,
    //      because the debugger knows how to find automatically the right lldb-mi when miMode is lldb and miDebuggerPath is undefined
    //      (this is true for systems older than Catalina).
    // Additionally, cppvsdbg ignores miMode and miDebuggerPath.
    public prepareDebugCurrentTarget(currentLaunchConfiguration: configuration.LaunchConfiguration): vscode.DebugConfiguration {
        let args: string[] = this.launchTargetArgs();

        let compilerPath : string | undefined = extension.extension.getCompilerFullPath();
        let parsedObjPath : path.ParsedPath | undefined = compilerPath ? path.parse(compilerPath) : undefined;
        let isClangCompiler : boolean | undefined = parsedObjPath?.name.startsWith("clang");
        let isMsvcCompiler : boolean | undefined = !isClangCompiler && parsedObjPath?.name.startsWith("cl");
        let dbg: string = (isMsvcCompiler) ? "cppvsdbg" : "cppdbg";

        // Initial debugger guess
        let guessMiDebuggerPath : string | undefined = (!isMsvcCompiler && parsedObjPath) ? parsedObjPath.dir : undefined;
        let guessMiMode: string | undefined;
        if (parsedObjPath?.name.startsWith("clang")) {
            guessMiMode = "lldb";
        } else if (!parsedObjPath?.name.startsWith("cl")) {
            guessMiMode = "gdb";
        }

        // If the first chosen debugger is not installed, try the other one.
        if (guessMiDebuggerPath && guessMiMode) {
            let debuggerPath: string = path.join(guessMiDebuggerPath, guessMiMode);
            if (process.platform === "win32") {
                // On mingw a file is not found if the extension is not part of the path
                debuggerPath = debuggerPath + ".exe";
            }

            if (!util.checkFileExistsSync(debuggerPath)) {
                guessMiMode = (guessMiMode === "gdb") ? "lldb" : "gdb";
            }
        }

        // Properties defined by makefile.launchConfigurations override makefile.defaultLaunchConfiguration
        // and they both override the guessed values.
        let defaultLaunchConfiguration: configuration.DefaultLaunchConfiguration | undefined = configuration.getDefaultLaunchConfiguration();
        let miMode: string | undefined = currentLaunchConfiguration.MIMode || defaultLaunchConfiguration?.MIMode || guessMiMode;
        let miDebuggerPath: string | undefined = currentLaunchConfiguration.miDebuggerPath || defaultLaunchConfiguration?.miDebuggerPath || guessMiDebuggerPath;

        // Exception for MAC-lldb, point to the lldb-mi installed by CppTools or set debugger path to undefined
        // (more details in the comment at the beginning of this function).
        if (miMode === "lldb" && process.platform === "darwin") {
            const cpptoolsExtension: vscode.Extension<any> | undefined = vscode.extensions.getExtension('ms-vscode.cpptools');
            miDebuggerPath = cpptoolsExtension ? path.join(cpptoolsExtension.extensionPath, "debugAdapters", "lldb-mi", "bin", "lldb-mi") : undefined;
        } else if (miDebuggerPath && miMode) {
            miDebuggerPath = path.join(miDebuggerPath, miMode);
            if (process.platform === "win32") {
                miDebuggerPath = miDebuggerPath + ".exe";
            }
        }

        let debugConfig: vscode.DebugConfiguration = {
            type: dbg,
            name: `Debug My Program`,
            request: 'launch',
            cwd: '${command:makefile.launchTargetDirectory}',
            args,
            program: '${command:makefile.launchTargetPath}',
            MIMode: miMode,
            miDebuggerPath: miDebuggerPath,
            console: "internalConsole",
            internalConsoleOptions: "openOnSessionStart",
            stopAtEntry: currentLaunchConfiguration.stopAtEntry || defaultLaunchConfiguration?.stopAtEntry,
            symbolSearchPath: currentLaunchConfiguration.symbolSearchPath || defaultLaunchConfiguration?.symbolSearchPath
        };

        logger.message("Created the following debug config:\n   type = " + debugConfig.type +
                       "\n   cwd = " + debugConfig.cwd + " (= " + this.launchTargetDirectory() + ")" +
                       "\n   args = " + args.join(" ") +
                       "\n   program = " + debugConfig.program + " (= " + this.launchTargetPath() + ")" +
                       "\n   MIMode = " + debugConfig.MIMode +
                       "\n   miDebuggerPath = " + debugConfig.miDebuggerPath +
                       "\n   stopAtEntry = " + debugConfig.stopAtEntry +
                       "\n   symbolSearchPath = " + debugConfig.symbolSearchPath);

        return debugConfig;
    }

    async validateLaunchConfiguration(op: make.Operations): Promise<string> {
        // Cannot debug the project if it is currently building or (pre-)configuring.
        if (make.blockedByOp(op)) {
            return LaunchStatuses.blocked;
        }

        let currentLaunchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (!currentLaunchConfiguration) {
            // If no launch configuration is set, give the user a chance to select one now from the quick pick
            // (unless we know it's going to be empty).
            if (configuration.getLaunchTargets().length === 0) {
                vscode.window.showErrorMessage(`Cannot ${op} because there is no launch configuration set` +
                    " and the list of launch targets is empty. Double check the makefile configuration and the build target.");
                return LaunchStatuses.launchTargetsListEmpty;
            } else {
                vscode.window.showErrorMessage(`Cannot ${op} because there is no launch configuration set. Choose one from the quick pick.`);
                await configuration.selectLaunchConfiguration();

                // Read again the current launch configuration. If a current launch configuration is stil not set
                // (the user cancelled the quick pick or the parser found zero launch targets) message and fail.
                currentLaunchConfiguration = configuration.getCurrentLaunchConfiguration();
                if (!currentLaunchConfiguration) {
                    vscode.window.showErrorMessage(`Cannot ${op} until you select an active launch configuration.`);
                    return LaunchStatuses.noLaunchConfigurationSet;
                }
            }
        }

        return LaunchStatuses.success;
    }

    public async debugCurrentTarget(): Promise<vscode.DebugSession | undefined> {
        let status: string = await this.validateLaunchConfiguration(make.Operations.debug);
        let currentLaunchConfiguration: configuration.LaunchConfiguration | undefined;
        if (status === LaunchStatuses.success) {
            currentLaunchConfiguration = configuration.getCurrentLaunchConfiguration();
        }

        if (currentLaunchConfiguration) {
            let debugConfig: vscode.DebugConfiguration = this.prepareDebugCurrentTarget(currentLaunchConfiguration);
            let startFolder: vscode.WorkspaceFolder;
            if (vscode.workspace.workspaceFolders) {
                startFolder = vscode.workspace.workspaceFolders[0];
                await vscode.debug.startDebugging(startFolder, debugConfig);
            } else {
                await vscode.debug.startDebugging(undefined, debugConfig);
            }

            if (!vscode.debug.activeDebugSession) {
                status = "failed";
            }
        }

        let telemetryProperties: telemetry.Properties = {
            status: status
        };
        telemetry.logEvent("debug", telemetryProperties);

        return vscode.debug.activeDebugSession;
    }

    private launchTerminal: vscode.Terminal | undefined;

    // Watch for the user closing our terminal
    private readonly onTerminalClose = vscode.window.onDidCloseTerminal(term => {
        if (term === this.launchTerminal) {
            this.launchTerminal = undefined;
        }
    });

    // Invoke a VS Code running terminal passing it all the information
    // from the current launch configuration
    public prepareRunCurrentTarget(): string {
        // Add a pair of quotes just in case there is a space in the binary path
        let terminalCommand: string = '"' + this.launchTargetPath() + '" ';
        terminalCommand += this.launchTargetArgs().join(" ");

        // Log the message for high verbosity only because the output channel will become visible over the terminal,
        // even if the terminal show() is called after the logger show().
        logger.message("Running command '" + terminalCommand + "' in the terminal from location '" + this.launchTargetDirectory() + "'", "Debug");
        return terminalCommand;
    }

    public async runCurrentTarget(): Promise<vscode.Terminal> {
        const terminalOptions: vscode.TerminalOptions = {
            name: 'Make/Launch',
        };

        // Use cmd.exe on Windows
        if (process.platform === 'win32') {
            terminalOptions.shellPath = 'C:\\Windows\\System32\\cmd.exe';
        }

        terminalOptions.cwd = this.launchTargetDirectory();

        if (!this.launchTerminal) {
            this.launchTerminal = vscode.window.createTerminal(terminalOptions);
        }

        let status: string = await this.validateLaunchConfiguration(make.Operations.run);
        let currentLaunchConfiguration: configuration.LaunchConfiguration | undefined;
        if (status === LaunchStatuses.success) {
            currentLaunchConfiguration = configuration.getCurrentLaunchConfiguration();
            let terminalCommand: string = this.prepareRunCurrentTarget();
            this.launchTerminal.sendText(terminalCommand);

            let telemetryProperties: telemetry.Properties = {
                status: status
            };
            telemetry.logEvent("run", telemetryProperties);
            this.launchTerminal.show();
        }

        return this.launchTerminal;
    }

    public dispose(): void {
        if (this.launchTerminal) {
            this.launchTerminal.dispose();
        }

        this.onTerminalClose.dispose();
    }
}

export function getLauncher(): Launcher {
    if (launcher === undefined) {
        launcher = new Launcher();
    }

    return launcher;
}

// Launch support: debug and run in terminal

import * as configuration from './configuration';
import * as util from './util';
import * as vscode from 'vscode';

let launcher: Launcher;

export class Launcher implements vscode.Disposable {
    // Command property accessible from launch.json:
    // the full path of the target binary currently set for launch
    public launchTargetPath(): string {
        let launchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.binary;
        } else {
            return "";
        }
    }

    // Command property accessible from launch.json:
    // the full path from where the target binary is to be launched
    public launchCurrentDir(): string {
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
            return launchConfiguration.args;
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
    // from the current launch configuration
    public async debugCurrentTarget(): Promise<vscode.DebugSession | undefined> {
        let args: string[] = this.launchTargetArgs();

        let dbg: string;
        if (process.platform === "win32") {
            dbg = "cppvsdbg";
        } else {
            dbg = "cppdbg";
        }

        let debugConfig: vscode.DebugConfiguration;
        debugConfig = {
            type: dbg,
            name: `Debug My Program`,
            request: 'launch',
            cwd: '${command:Make.launchCurrentDir}',
            args,
            program: '${command:Make.launchTargetPath}'
        };

        await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], debugConfig);
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
    public async runCurrentTarget(): Promise<vscode.Terminal> {
        const terminalOptions: vscode.TerminalOptions = {
            name: 'Make/Launch',
        };

        // Use cmd.exe on Windows
        if (process.platform === 'win32') {
            terminalOptions.shellPath = 'C:\\Windows\\System32\\cmd.exe';
            terminalOptions.cwd = this.launchCurrentDir();
        }

        if (!this.launchTerminal) {
            this.launchTerminal = vscode.window.createTerminal(terminalOptions);
        }

        // Add a pair of quotes just in case there is a space in the binary path
        let terminalCommand: string = '"' + this.launchTargetPath() + '" ';
        terminalCommand += this.launchTargetArgs().join(" ");
        this.launchTerminal.sendText(terminalCommand);
        this.launchTerminal.show();
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

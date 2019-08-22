import * as configuration from './configuration';
import * as util from './util';
import * as vscode from 'vscode';

let launcher: Launcher;

export class Launcher implements vscode.Disposable {
    launchTargetPath(): string {
        let launchConfiguration : configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.binary;
        } else {
            return "";
        }
    }

    launchTargetDir(): string {
        let launchConfiguration : configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.cwd;
        } else {
            return vscode.workspace.rootPath || "";
        }
    }

    launchTargetArgs(): string[] {
        let launchConfiguration : configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
        if (launchConfiguration) {
            return launchConfiguration.args;
        } else {
            return [];
        }
    }

    launchTargetArgsConcatenated() : string {
        return this.launchTargetArgs().join(" ");
    }

    async debugCurrentTarget(): Promise<vscode.DebugSession | undefined> {
        let debugConfig: vscode.DebugConfiguration;
        let args: string[] = this.launchTargetArgs();
        let dbg: string;
        if (process.platform === "win32") {
            dbg = "cppvsdbg";
        } else {
            dbg = "cppdbg";
        }

        debugConfig = {
            type: dbg,
            name: `Debug My Program`,
            request: 'launch',
            cwd: '${command:Make.launchTargetDir}',
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

    async runCurrentTarget() {
        const terminalOptions: vscode.TerminalOptions = {
            name: 'Make/Launch',
        };

        // Use cmd.exe on Windows
        if (process.platform == 'win32') {
            terminalOptions.shellPath = 'C:\\Windows\\System32\\cmd.exe';
            terminalOptions.cwd = this.launchTargetDir();
        }

        if (!this.launchTerminal) {
            this.launchTerminal = vscode.window.createTerminal(terminalOptions);
        }

        let quoted : string = util.quote(this.launchTargetPath());
        quoted += " " + this.launchTargetArgs().join(" ");
        this.launchTerminal.sendText(quoted);
        this.launchTerminal.show();
        return this.launchTerminal;
    }

    dispose() {
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

import * as vscode from 'vscode';

// todo: implement more verbosity levels (currently loggingLevel is read but never used)
let loggingLevel: string | undefined;
let makeOutputChannel: vscode.OutputChannel | undefined;

function getCurrentLoggingLevel() {
    if (!loggingLevel) {
        let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
        loggingLevel = workspaceConfiguration.get<string>("Make.loggingLevel");
    }

    return loggingLevel;
}

function GetOutputChannel() {
    if (!makeOutputChannel) {
        makeOutputChannel = vscode.window.createOutputChannel("Makefile tools");
    }

    return makeOutputChannel;
}

export function Message(message: string) {
    let channel = GetOutputChannel();
    channel.appendLine(message);
}

// This is used for a few scenarios where the message already has end of line incorporated.
// Example: stdout/stderr of a child process read before the stream is closed.
export function MessageNoCR(message: string) {
    let channel = GetOutputChannel();
    channel.append(message);
}

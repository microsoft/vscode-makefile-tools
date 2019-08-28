// Logging support

import * as vscode from 'vscode';

// todo: implement more verbosity levels (currently loggingLevel is read but never used)
let loggingLevel: string | undefined;
let makeOutputChannel: vscode.OutputChannel | undefined;

function getCurrentLoggingLevel(): string | undefined {
    if (!loggingLevel) {
        let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
        loggingLevel = workspaceConfiguration.get<string>("Makefile.loggingLevel");
    }

    return loggingLevel;
}

function getOutputChannel(): vscode.OutputChannel {
    if (!makeOutputChannel) {
        makeOutputChannel = vscode.window.createOutputChannel("Makefile tools");
    }

    return makeOutputChannel;
}

export function message(message: string): void {
    let channel: vscode.OutputChannel = getOutputChannel();
    channel.show();
    channel.appendLine(message);
}

// This is used for a few scenarios where the message already has end of line incorporated.
// Example: stdout/stderr of a child process read before the stream is closed.
export function messageNoCR(message: string): void {
    let channel: vscode.OutputChannel = getOutputChannel();
    channel.show();
    channel.append(message);
}

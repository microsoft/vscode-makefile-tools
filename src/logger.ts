// Logging support

import * as fs from 'fs';
import * as configuration from './configuration';
import * as vscode from 'vscode';

let makeOutputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!makeOutputChannel) {
        makeOutputChannel = vscode.window.createOutputChannel("Makefile tools");
    }

    return makeOutputChannel;
}

//TODO: implement more verbosity levels for the output log
export function message(message: string, loggingLevel?: string): void {
    // Print the message only if the intended logging level matches the settings
    // or if no loggingLevel restriction is provided.
    if (loggingLevel && configuration.getLoggingLevel() !== loggingLevel) {
        return;
    }

    let channel: vscode.OutputChannel = getOutputChannel();
    channel.show();
    channel.appendLine(message);

    let extensionLog : string | undefined = configuration.getExtensionLog();
    if (extensionLog) {
       fs.appendFileSync(extensionLog, message);
       fs.appendFileSync(extensionLog, "\n");
    }
}

// This is used for a few scenarios where the message already has end of line incorporated.
// Example: stdout/stderr of a child process read before the stream is closed.
export function messageNoCR(message: string, loggingLevel?: string): void {
    // Print the message only if the intended logging level matches the settings
    // or if no loggingLevel restriction is provided.
    if (loggingLevel && configuration.getLoggingLevel() !== loggingLevel) {
        return;
    }

    let channel: vscode.OutputChannel = getOutputChannel();
    channel.show();
    channel.append(message);

    let extensionLog : string | undefined = configuration.getExtensionLog();
    if (extensionLog) {
       fs.appendFileSync(extensionLog, message);
    }
}

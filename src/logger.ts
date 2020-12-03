// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Logging support

import * as fs from 'fs';
import * as configuration from './configuration';
import * as vscode from 'vscode';

let makeOutputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!makeOutputChannel) {
        makeOutputChannel = vscode.window.createOutputChannel("Makefile tools");
        makeOutputChannel.show(true); // don't take focus
    }

    return makeOutputChannel;
}

// TODO: process verbosities with enums instead of strings.
// This is a temporary hack.
function loggingLevelApplies(messageVerbosity: string | undefined): boolean {
    let projectVerbosity: string | undefined = configuration.getLoggingLevel();

    if (messageVerbosity === "Debug") {
        return projectVerbosity === "Debug";
    } else if (messageVerbosity === "Verbose") {
        return projectVerbosity === "Verbose" || projectVerbosity === "Debug";
    }

    return true;
}

//TODO: implement more verbosity levels for the output log
export function message(message: string, loggingLevel?: string): void {
    // Print the message only if the intended logging level matches the settings
    // or if no loggingLevel restriction is provided.
    if (!loggingLevelApplies(loggingLevel)) {
        return;
    }

    // Don't show the output channel when the message verbosity level is not normal,
    // to avoid various switch focus events, which may even trigger a configure
    // (if makefile.configureOnEdit is true and the configure state is dirty).
    // We want the focus change events to be triggered by changing editors,
    // not by the output channel writing one more message, especially of lower importance.
    if (!loggingLevel || loggingLevel === "Normal") {
        makeOutputChannel?.show(true); // don't take focus
    }

    let channel: vscode.OutputChannel = getOutputChannel();
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
    if (!loggingLevelApplies(loggingLevel)) {
        return;
    }

    // Don't show the output channel when the message verbosity level is not normal,
    // to avoid various switch focus events, which may even trigger a configure
    // (if makefile.configureOnEdit is true and the configure state is dirty).
    // We want the focus change events to be triggered by changing editors,
    // not by the output channel writing one more message, especially of lower importance.
    if (!loggingLevel || loggingLevel === "Normal") {
        makeOutputChannel?.show(true); // don't take focus
    }

    let channel: vscode.OutputChannel = getOutputChannel();
    channel.append(message);

    let extensionLog : string | undefined = configuration.getExtensionLog();
    if (extensionLog) {
       fs.appendFileSync(extensionLog, message);
    }
}

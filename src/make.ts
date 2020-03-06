// Support for make operations

import * as child_process from 'child_process';
import * as configuration from './configuration';
import * as ext from './extension';
import * as logger from './logger';
import * as util from './util';
import * as vscode from 'vscode';

export async function buildCurrentTarget(): Promise<void> {
    let commandArgs: string[] = [];
    // Prepend the target to the arguments given in the configurations json.
    let currentTarget: string | undefined = configuration.getCurrentTarget();
    if (currentTarget) {
        commandArgs.push(currentTarget);
    }

    commandArgs = commandArgs.concat(configuration.getConfigurationCommandArgs());

    logger.message("Building the current target. Command: " + configuration.getConfigurationCommandName() + " " + commandArgs.join(" "));

    try {
        // Append without end of line since there is one already included in the stdout/stderr fragments
        let stdout : any = (result: string): void => {
            logger.messageNoCR(result);
        };

        let stderr : any = (result: string): void => {
            logger.messageNoCR(result);
        };

        let closing : any = (retCode: number, signal: string): void => {
            if (retCode !== 0) {
                logger.message("The current target failed to build.");
            } else {
                logger.message("The current target built successfully.");
            }
        };

        await util.spawnChildProcess(configuration.getConfigurationCommandName(), commandArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        // No need for notification popup, since the build result is visible already in the output channel
        logger.message(error);
        return;
    }
}

export async function dryRun(): Promise<void> {
    let commandArgs: string[] = [];

    // Prepend the target to the arguments given in the configurations json.
    let currentTarget: string | undefined = configuration.getCurrentTarget();
    if (currentTarget) {
        commandArgs.push(currentTarget);
    }

    // Append --dry-run (to not perform any real build operation),
    // --always-make (to not skip over targets when timestamps indicate nothing needs to be done)
    // and --keep-going (to ensure we get as much info as possible even when some targets fail)
    commandArgs = commandArgs.concat(configuration.getConfigurationCommandArgs());
    commandArgs.push("--dry-run");
    commandArgs.push("--always-make");
    commandArgs.push("--keep-going");

    logger.message("Generating the make dry-run output for parsing IntelliSense information. Command: " +
        configuration.getConfigurationCommandName() + " " + commandArgs.join(" "));

    try {
        let stdoutStr: string = "";
        let stderrStr: string = "";

        let stdout : any = (result: string): void => {
            stdoutStr += result;
        };

        let stderr : any = (result: string): void => {
            stderrStr += result;
        };

        let closing : any = (retCode: number, signal: string): void => {
            if (retCode !== 0) {
                logger.message("The make dry-run command failed.");
                logger.message(stderrStr);
            }

            console.log("Make dry-run output to parse is:\n" + stdoutStr);
            ext.updateProvider(stdoutStr);
        };

        await util.spawnChildProcess(configuration.getConfigurationCommandName(), commandArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        logger.message(error);
        return;
    }
}

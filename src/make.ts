// Support for make operations

import * as configuration from './configuration';
import * as ext from './extension';
import * as fs from 'fs';
import * as logger from './logger';
import * as util from './util';
import * as vscode from 'vscode';

export function prepareBuildCurrentTarget(): string[] {
    let makeArgs: string[] = [];
    // Prepend the target to the arguments given in the configurations json.
    let currentTarget: string | undefined = configuration.getCurrentTarget();
    if (currentTarget) {
        makeArgs.push(currentTarget);
    }

    makeArgs = makeArgs.concat(configuration.getConfigurationMakeArgs());

    logger.message("Building the current target. Command: " + configuration.getConfigurationMakeCommand() + " " + makeArgs.join(" "));
    return makeArgs;
}

export async function buildCurrentTarget(): Promise<void> {
    let makeArgs: string[] = prepareBuildCurrentTarget();
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

        await util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        // No need for notification popup, since the build result is visible already in the output channel
        logger.message(error);
        return;
    }
}
export function parseBuild(): boolean {
    let buildLog : string | undefined = configuration.getConfigurationBuildLog();
    let buildLogContent: string | undefined = buildLog ? util.readFile(buildLog) : undefined;
    if (buildLogContent) {
        logger.message('Parsing the provided build log "' + buildLog + '" for IntelliSense integration with CppTools...');
        ext.updateProvider(buildLogContent);
        return true;
    }

    return false;
}

export async function parseBuildOrDryRun(): Promise<void> {
    // If a build log is specified in makefile.configurations or makefile.buildLog
    // (and if it exists on disk) it must be parsed instead of invoking a dry-run make command.
    if (parseBuild()) {
        return;
    }

    let makeArgs: string[] = [];

    // Prepend the target to the arguments given in the configurations json.
    let currentTarget: string | undefined = configuration.getCurrentTarget();
    if (currentTarget) {
        makeArgs.push(currentTarget);
    }

    // Include all the make arguments defined in makefile.configurations.makeArgs
    makeArgs = makeArgs.concat(configuration.getConfigurationMakeArgs());

    // Append --dry-run switches
    makeArgs.push("--dry-run");
    const dryRunSwitches: string[] | undefined = configuration.getDryRunSwitches();
    if (dryRunSwitches) {
        makeArgs = makeArgs.concat(dryRunSwitches);
    }

    logger.message("Generating the make dry-run output for parsing IntelliSense information. Command: " +
        configuration.getConfigurationMakeCommand() + " " + makeArgs.join(" "));

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
            let dryrunCache: string = configuration.getDryrunCache();
            if (retCode !== 0) {
                logger.message("The make dry-run command failed. IntelliSense may work only partially or not at all.");
                logger.message(stderrStr);
                util.reportDryRunError();
            }

            fs.writeFileSync(dryrunCache, stdoutStr);
            ext.updateProvider(stdoutStr);
        };

        await util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        logger.message(error);
        return;
    }
}

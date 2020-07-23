// Support for make operations

import * as configuration from './configuration';
import * as ext from './extension';
import * as fs from 'fs';
import * as logger from './logger';
import * as util from './util';
import * as vscode from 'vscode';

export function prepareBuildTarget(target: string, clean: boolean = false): string[] {
    let makeArgs: string[] = [];
    // Prepend the target to the arguments given in the configurations json.
    // If a clean build is desired, "clean" should precede the target.
    if (clean) {
        makeArgs.push("clean");
    }
    if (target) {
        makeArgs.push(target);
    }

    makeArgs = makeArgs.concat(configuration.getConfigurationMakeArgs());

    logger.message("Building the current target. Command: " + configuration.getConfigurationMakeCommand() + " " + makeArgs.join(" "));
    return makeArgs;
}

export async function buildTarget(target: string, clean: boolean = false): Promise<void> {
    // Prepare a notification popup
    let config : string | undefined = configuration.getCurrentMakefileConfiguration();
    let configAndTarget : string = config;
    if (target) {
        target = target.trimLeft();
        if (target !== "") {
            configAndTarget += "/" + target;
        }
    }

    configAndTarget = `"${configAndTarget}"`;
    vscode.window.showInformationMessage('Building ' + (clean ? "clean " : "") + 'the current makefile configuration ' + configAndTarget);

    let makeArgs: string[] = prepareBuildTarget(target, clean);
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
                logger.message(`Target ${target} failed to build.`);
            } else {
                logger.message(`Target ${target} built successfully.`);
            }
        };

        await util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        // No need for notification popup, since the build result is visible already in the output channel
        logger.message(error);
    }
}

// Content to be parsed by various operations post configure (like finding all build/launch targets).
// Represents the content of the provided makefile.buildLog or a fresh output of make --dry-run
// (which is also written into makefile.configurationCache).
let parseContent: string;
export function getParseContent(): string { return parseContent; }
export function setParseContent(content: string): void { parseContent = content; }

// The source file of parseContent (build log or configuration dryrun cache).
let parseFile: string;
export function getParseFile(): string { return parseFile; }
export function setParseFile(file: string): void { parseFile = file; }

export function parseBuild(): boolean {
    let buildLog: string | undefined = configuration.getConfigurationBuildLog();
    if (buildLog) {
            parseContent = util.readFile(buildLog) || "";
            parseFile = buildLog;
            logger.message('Parsing the provided build log "' + buildLog + '" for IntelliSense integration with CppTools...');
            ext.updateProvider(parseContent);
            return true;
    }

    return false;
}

export async function parseBuildOrDryRun(): Promise<void> {
    // This may be called by running the command makefile.configure or at project opening (unless makefile.configureOnOpen is false)
    // or after the watchers detect a relevant change in settings or makefiles (unless makefile.configureOnEdit is false).
    // This is the place to check for always pre-configure.
    if (configuration.getAlwaysPreconfigure()) {
        runPreconfigureScript();
    }

    // Reset the config provider update pending boolean
    configuration.setConfigProviderUpdatePending(false);

    // If a build log is specified in makefile.configurations or makefile.buildLog
    // (and if it exists on disk) it must be parsed instead of invoking a dry-run make command.
    // If a dry-run cache is present, we don't parse from it here. This operation is performed
    // when a project is loaded (we don't know how any setting or makefile have been changed
    // since the last open) and when the user executes the makefile.configure command
    // (which doesn't make sense to be run without some edits since the last configure).
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
    const dryrunSwitches: string[] | undefined = configuration.getDryrunSwitches();
    if (dryrunSwitches) {
        makeArgs = makeArgs.concat(dryrunSwitches);
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
            let configurationCache: string = configuration.getConfigurationCache();
            if (retCode !== 0) {
                logger.message("The make dry-run command failed. IntelliSense may work only partially or not at all.");
                logger.message(stderrStr);
                util.reportDryRunError();
            }

            fs.writeFileSync(configurationCache, stdoutStr);
            parseContent = stdoutStr;
            parseFile = configurationCache;
            ext.updateProvider(stdoutStr);
        };

        await util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        logger.message(error);
    }
}

export async function runPreconfigureScript(): Promise<void> {
    let script: string | undefined = configuration.getPreconfigureScript();
    if (!script || !util.checkFileExistsSync(script)) {
        vscode.window.showErrorMessage("Could not find pre-configure script.");
        logger.message("Make sure a pre-configuration script path is defined with makefile.preconfigureScript and that it exists on disk.");
        return;
    }

    let scriptArgs: string[] = [];
    let runCommand: string;
    if (process.platform === 'win32') {
        runCommand = "cmd";
        scriptArgs.push("/c");
        scriptArgs.push(script);
    } else {
        runCommand = "/bin/bash";
        scriptArgs.push("-c");
        scriptArgs.push(`"source ${script}"`);
    }

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
            if (retCode === 0) {
                logger.message("The preconfigure script run successfully.");
            } else {
                logger.message("The preconfigure script failed. This project may not configure successfully.");
                logger.message(stderrStr);
            }
        };

        await util.spawnChildProcess(runCommand, scriptArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        logger.message(error);
    }
}

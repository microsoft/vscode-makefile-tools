// Support for make operations

import * as configuration from './configuration';
import * as ext from './extension';
import * as fs from 'fs';
import * as logger from './logger';
import * as parser from './parser';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';

let isBuilding: boolean = false;
export function getIsBuilding(): boolean { return isBuilding; }
export function setIsBuilding(building: boolean): void {
    isBuilding = building;
}

let isConfiguring: boolean = false;
export function getIsConfiguring(): boolean { return isConfiguring; }
export function setIsConfiguring(configuring: boolean): void { isConfiguring = configuring; }

let isPreConfiguring: boolean = false;
export function getIsPreConfiguring(): boolean { return isPreConfiguring; }
export function setIsPreConfiguring(preConfiguring: boolean): void { isPreConfiguring = preConfiguring; }

// Identifies and logs whether an operation should be prevented from running.
// So far, the only blocking scenarios are if an ongoing configure, pre-configure or build
// is blocking other new similar operations and setter commands (selection of new configurations, targets, etc...)
// Getter commands are not blocked, even if by the time the (pre-)configure or build operations are completed
// they might be out of date.
// For the moment, the status bar buttons don't change when an operation is blocked
// and cancelling is done only via a button in the bottom right popup.
// Clicking the status bar buttons attempts to run the corresponding operation,
// which triggers a popup and returns early if it should be blocked. Same for pallette commands.
// In future we may enable/disable or change text depending on the blocking state.
export function blockOperation(): boolean {
    let block: boolean = false;

    if (getIsPreConfiguring()) {
        vscode.window.showErrorMessage("This operation cannot be completed because the project is pre-configuring.");
        block = true;
    }

    if (getIsConfiguring()) {
        vscode.window.showErrorMessage("This operation cannot be completed because the project is configuring.");
        block = true;
    }

    if (getIsBuilding()) {
        vscode.window.showErrorMessage("This operation cannot be completed because the project is building.");
        block = true;
    }

    return block;
}

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
    if (blockOperation()) {
        return;
    }

    return new Promise<void>(function (resolve, reject): void {
        setIsBuilding(true);

        // Prepare a notification popup
        let config: string | undefined = configuration.getCurrentMakefileConfiguration();
        let configAndTarget: string = config;
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
            let stdout: any = (result: string): void => {
                logger.messageNoCR(result);
            };

            let stderr: any = (result: string): void => {
                logger.messageNoCR(result);
            };

            let closing: any = (retCode: number, signal: string): void => {
                if (retCode !== 0) {
                    logger.message(`Target ${target} failed to build.`);
                } else {
                    logger.message(`Target ${target} built successfully.`);
                }

                setIsBuilding(false);
                resolve();
            };

            util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
        } catch (error) {
            // No need for notification popup, since the build result is visible already in the output channel
            logger.message(error);
        }
    });
}

// Content to be parsed by various operations post configure (like finding all build/launch targets).
// Represents the content of the provided makefile.buildLog or a fresh output of make --dry-run
// (which is also written into makefile.configurationCache).
let parseContent: string | undefined;
export function getParseContent(): string | undefined { return parseContent; }
export function setParseContent(content: string): void { parseContent = content; }

// The source file of parseContent (build log or configuration dryrun cache).
let parseFile: string | undefined;
export function getParseFile(): string | undefined { return parseFile; }
export function setParseFile(file: string): void { parseFile = file; }

// Targets need to parse a dryrun make invocation that does not include a target name
// (other than default empty "" or the standard "all"), otherwise it would produce
// a subset of all the targets involved in the makefile (only the ones triggered
// by building the current target).
export async function generateParseContent(forTargets: boolean = false): Promise<void> {
    // Rules for parse content and file:
    //     1. makefile.buildLog provided by the user in settings
    //     2. configuration cache (the previous dryrun output): makefile.configurationCache
    //     3. the make dryrun output if (2) is missing
    let buildLog: string | undefined = configuration.getConfigurationBuildLog();
    if (buildLog) {
        parseContent = util.readFile(buildLog);
        if (parseContent) {
            parseFile = buildLog;
            return;
        }
    }

    let cache: string = configuration.getConfigurationCache();
    if (cache) {
        // We are looking at a different cache file for targets parsing,
        // located in the same folder as makefile.configurationCache
        // but with the file name configurationCache.log.
        // The user doesn't need to know about this, so there's no setting.
        if (forTargets) {
            cache = path.parse(cache).dir;
            cache = path.join(cache, "targetsCache.log");
        }

        parseContent = util.readFile(cache);
        if (parseContent) {
            parseFile = cache;
            return;
        }
    }

    return new Promise<void>(function (resolve, reject): void {
        // Continue with the make dryrun invocation
        let makeArgs: string[] = [];

        // Prepend the target to the arguments given in the configurations json,
        // unless we want to parse for the full set of available targets.
        if (!forTargets) {
            let currentTarget: string | undefined = configuration.getCurrentTarget();
            if (currentTarget) {
                makeArgs.push(currentTarget);
            }
        }

        // Include all the make arguments defined in makefile.configurations.makeArgs
        makeArgs = makeArgs.concat(configuration.getConfigurationMakeArgs());

        // Append --dry-run switches
        makeArgs.push("--dry-run");
        const dryrunSwitches: string[] | undefined = configuration.getDryrunSwitches();
        if (dryrunSwitches) {
            makeArgs = makeArgs.concat(dryrunSwitches);
        }

        if (forTargets) {
            logger.messageNoCR("Generating targets information with command: ");
        } else {
            logger.messageNoCR("Generating configuration cache with command: ");
        }

        logger.message(configuration.getConfigurationMakeCommand() + " " + makeArgs.join(" "));

        try {
            let stdoutStr: string = "";
            let stderrStr: string = "";

            let stdout: any = (result: string): void => {
                stdoutStr += result;
            };

            let stderr: any = (result: string): void => {
                stderrStr += result;
            };

            let closing: any = (retCode: number, signal: string): void => {
                if (retCode !== 0) {
                    logger.message("The make dry-run command failed.");
                    if (forTargets) {
                        logger.message("We may parse an incomplete set of build targets.");
                    } else {
                        logger.message("IntelliSense may work only partially or not at all.");
                    }
                    logger.message(stderrStr);
                    util.reportDryRunError();
                }

                logger.message(`Writing the configuration cache: ${cache}`);
                fs.writeFileSync(cache, stdoutStr);
                parseContent = stdoutStr;
                parseFile = cache;

                resolve();
            };

            util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
        } catch (error) {
            logger.message(error);
        }
    });
}

export async function runPreconfigureScript(): Promise<void> {
    let scriptFile: string | undefined = configuration.getPreconfigureScript();
    if (!scriptFile || !util.checkFileExistsSync(scriptFile)) {
        vscode.window.showErrorMessage("Could not find pre-configure script.");
        logger.message("Make sure a pre-configuration script path is defined with makefile.preconfigureScript and that it exists on disk.");
        return;
    }

    if (blockOperation()) {
        return;
    }

    return new Promise<void>(function (resolve, reject): void {
        logger.message(`Preconfiguring...\nScript: "${configuration.getPreconfigureScript()}"`);
        setIsPreConfiguring(true);

        let scriptArgs: string[] = [];
        let runCommand: string;
        if (process.platform === 'win32') {
            runCommand = "cmd";
            scriptArgs.push("/c");
            scriptArgs.push(`${scriptFile}`);
        } else {
            runCommand = "/bin/bash";
            scriptArgs.push("-c");
            scriptArgs.push(`"source ${scriptFile}"`);
        }

        try {
            let stdoutStr: string = "";
            let stderrStr: string = "";

            let stdout: any = (result: string): void => {
                stdoutStr += result;
            };

            let stderr: any = (result: string): void => {
                stderrStr += result;
            };

            let closing: any = (retCode: number, signal: string): void => {
                if (retCode === 0) {
                    logger.message("The preconfigure script run successfully.");
                } else {
                    logger.message("The preconfigure script failed. This project may not configure successfully.");
                    logger.message(stderrStr);
                }

                setIsPreConfiguring(false);
                resolve();
            };

            util.spawnChildProcess(runCommand, scriptArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
        } catch (error) {
            logger.message(error);
        }
    });
}

// Update IntelliSense and launch targets with information parsed from a user given build log,
// the dryrun cache or make dryrun output if the cache is not present.
// Sometimes the targets do not need an update (for example, when there has been
// a change in the current build target), as requested through the boolean.
// This saves unnecessary parsing which may be signifficant for very big code bases.
export async function configure(updateTargets: boolean = true): Promise<void> {
    if (configuration.getAlwaysPreconfigure()) {
        await runPreconfigureScript();
    }

    if (blockOperation()) {
        return;
    }

    logger.message("Configuring...");
    setIsConfiguring(true);

    // Reset the config provider update pending boolean
    configuration.setConfigProviderUpdatePending(false);

    // This generates the dryrun output and caches it.
    await generateParseContent();

    // Configure IntelliSense
    logger.message(`Parsing for IntelliSense from: "${parseFile}"`);
    await ext.updateProvider(parseContent || "");

    // Configure launch targets as parsed from the makefile
    // (and not as read from settings via makefile.launchConfigurations).
    logger.message(`Parsing for launch targets from: "${parseFile}"`);
    let launchConfigurations: string[] = [];
    parser.parseForLaunchConfiguration(parseContent || "").forEach(config => {
        launchConfigurations.push(configuration.launchConfigurationToString(config));
    });

    if (launchConfigurations.length === 0) {
        logger.message("No launch configurations have been detected.");
    } else {
        // Sort and remove duplicates (different targets may build into the same place,
        // launching doesn't need to know which version of the binary that is).
        launchConfigurations = launchConfigurations.sort().filter(function (elem, index, self): boolean {
            return index === self.indexOf(elem);
        });

        logger.message("Found the following launch targets defined in the makefile: " + launchConfigurations.join(";"));
        configuration.setLaunchTargets(launchConfigurations);
    }

    // Configure build targets only if necessary
    if (updateTargets) {
        // If the current target is other than default (empty "") or "all",
        // we need to generate a different dryrun output
        let target: string | undefined = configuration.getCurrentTarget();
        if (target !== "" && target !== "all") {
            await generateParseContent(true);
        }

        logger.message(`Parsing for build targets from: "${parseFile}"`);
        let buildTargets: string[] = parser.parseTargets(parseContent || "");
        if (buildTargets.length === 0) {
            logger.message("No build targets have been detected.");
        } else {
            configuration.setBuildTargets(buildTargets.sort());
            logger.message("Found the following build targets defined in the makefile: " + buildTargets.join(";"));
        }
    }

    setIsConfiguring(false);
}

// Delete the dryrun cache (including targets cache) and configure
export async function cleanConfigure(updateTargets: boolean = true): Promise<void> {
    let cache: string = configuration.getConfigurationCache();
    if (cache && util.checkFileExistsSync(cache)) {
        logger.message(`Deleting the configuration cache: ${cache}`);
        fs.unlinkSync(cache);
    }

    cache = path.parse(cache).dir;
    cache = path.join(cache, "targetsCache");
    if (cache && util.checkFileExistsSync(cache)) {
        logger.message(`Deleting the targets cache: ${cache}`);
        fs.unlinkSync(cache);
    }

    await configure(updateTargets);
}

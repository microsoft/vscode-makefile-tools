// Support for make operations

import * as configuration from './configuration';
import * as ext from './extension';
import * as fs from 'fs';
import * as logger from './logger';
import * as parser from './parser';
import * as path from 'path';
import * as util from './util';
import * as telemetry from './telemetry';
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

// Leave positive error codes for make exit values
export enum ConfigureBuildReturnCodeTypes {
    success = 0,
    blocked = -1,
    cancelled = -2,
    notFound = -3,
    mixedErr = -4
}

export enum Operations {
    preConfigure = "pre-configure",
    configure = "configure",
    build = "build",
    changeConfiguration = "change makefile configuration",
    changeBuildTarget = "change build target",
    changeLaunchTarget = "change launch target",
    launch = "debug/run"
}

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
export function blockOperation(op: Operations): boolean {
    let block: boolean = false;
    let reason: string = "unknown";

    if (getIsPreConfiguring()) {
        reason = "the project is pre-configuring";
        block = true;
    }

    if (getIsConfiguring()) {
        reason = "the project is configuring";
        block = true;
    }

    if (getIsBuilding()) {
        reason = "the project is building";
        block = true;
    }

    if (block) {
        vscode.window.showErrorMessage(`Operation "${op}" cannot be completed because ${reason}.`);
        const telemetryProperties: telemetry.Properties = {
            operationName: op.toString(),
            reason: reason
        };
        telemetry.logEvent("operationBlocked", telemetryProperties);
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

// PID of the process that may be running currently.
// At any moment, there is either no process or only one process running
// (make for configure, make for build or preconfigure cmd/bash).
// TODO: improve the code regarding curPID and how util.spawnChildProcess is setting it in make.ts unit.
let curPID: number = -1;
export function getCurPID(): number { return curPID; }
export function setCurPID(pid: number): void { curPID = pid; }

export async function buildTarget(target: string, clean: boolean = false): Promise<number> {
    if (blockOperation(Operations.build)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    // warn about an out of date configure state and configure if makefile.configureAfterCommand allows.
    if (configuration.getConfigureDirty()) {
        logger.message("The project needs to configure in order to build properly the current target.");
        if (configuration.getConfigureAfterCommand()) {
            let retc: number = await cleanConfigure();
            if (retc !== ConfigureBuildReturnCodeTypes.success) {
                logger.message("Attempting to run build after a failed configure.");
            }
        }
    }

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
    let popupStr: string = 'Building ' + (clean ? "clean " : "") + 'the current makefile configuration ' + configAndTarget;

    try {
        return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: popupStr,
                cancellable: true,
            },
            async (progress, cancel) => {
                cancel.onCancellationRequested(() => {
                    progress.report({increment: 1, message: "Cancelling..."});
                    logger.message("The user is cancelling the build...");
                    // Kill make and all its children subprocesses.
                    logger.message(`Attempting to kill the make process (PID = ${curPID}) and all its children subprocesses...`);
                    util.killTree(curPID);
                    telemetry.logEvent("buildCancelled");
                });

                setIsBuilding(true);
                let retc: number = await doBuildTarget(progress, target, clean);

                const telemetryProperties: telemetry.Properties = {
                    exitCode: retc.toString()
                };
                telemetry.logEvent("build", telemetryProperties);

                return retc;
            },
        );
    } finally {
        setIsBuilding(false);
    }
}

export async function doBuildTarget(progress: vscode.Progress<{}>, target: string, clean: boolean = false): Promise<number> {
    return new Promise<number>(function (resolve, reject): void {
        let makeArgs: string[] = prepareBuildTarget(target, clean);
        try {
            // Append without end of line since there is one already included in the stdout/stderr fragments
            let stdout: any = (result: string): void => {
                logger.messageNoCR(result);
                progress.report({increment: 1, message: "..."});
            };

            let stderr: any = (result: string): void => {
                logger.messageNoCR(result);
            };

            let closing: any = (retCode: number, signal: string): void => {
                if (retCode !== ConfigureBuildReturnCodeTypes.success) {
                    logger.message(`Target ${target} failed to build.`);
                } else {
                    logger.message(`Target ${target} built successfully.`);
                }

                resolve(retCode);
            };

            util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
        } catch (error) {
            // No need for notification popup, since the build result is visible already in the output channel
            logger.message(error);
            resolve(ConfigureBuildReturnCodeTypes.notFound);
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
export async function generateParseContent(progress: vscode.Progress<{}>, forTargets: boolean = false): Promise<number> {
    // Rules for parse content and file:
    //     1. makefile.buildLog provided by the user in settings
    //     2. configuration cache (the previous dryrun output): makefile.configurationCache
    //     3. the make dryrun output if (2) is missing
    let buildLog: string | undefined = configuration.getConfigurationBuildLog();
    if (buildLog) {
        parseContent = util.readFile(buildLog);
        if (parseContent) {
            parseFile = buildLog;
            return 0;
        }
    }

    let cache: string | undefined = configuration.getConfigurationCache();
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
            return 0;
        }
    }

    return new Promise<number>(function (resolve, reject): void {
        // Continue with the make dryrun invocation
        let makeArgs: string[] = [];

        // Prepend the target to the arguments given in the makefile.configurations object,
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
                progress.report({increment: 1, message: configureSubPhase});
            };

            let stderr: any = (result: string): void => {
                stderrStr += result;
            };

            let closing: any = (retCode: number, signal: string): void => {
                if (retCode !== ConfigureBuildReturnCodeTypes.success) {
                    logger.message("The make dry-run command failed.");
                    if (forTargets) {
                        logger.message("We may parse an incomplete set of build targets.");
                    } else {
                        logger.message("IntelliSense may work only partially or not at all.");
                    }
                    logger.message(stderrStr);
                    util.reportDryRunError();
                }

                if (cache) {
                    logger.message(`Writing the configuration cache: ${cache}`);
                    fs.writeFileSync(cache, stdoutStr);
                    parseFile = cache;
                }
                parseContent = stdoutStr;

                resolve(retCode);
                curPID = -1;
            };

            util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
        } catch (error) {
            resolve(ConfigureBuildReturnCodeTypes.notFound);
            logger.message(error);
        }
    });
}

export async function preConfigure(): Promise<number> {
    if (blockOperation(Operations.preConfigure)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    let scriptFile: string | undefined = configuration.getPreconfigureScript();
    if (!scriptFile) {
        vscode.window.showErrorMessage("Preconfigure failed: no script provided.");
        logger.message("No pre-configure script is set in settings. " +
                       "Make sure a pre-configuration script path is defined with makefile.preconfigureScript.");
        return ConfigureBuildReturnCodeTypes.notFound;
    }

    if (!util.checkFileExistsSync(scriptFile)) {
        vscode.window.showErrorMessage("Could not find pre-configure script.");
        logger.message(`Could not find the given pre-configure script "${scriptFile}" on disk. `);
        return ConfigureBuildReturnCodeTypes.notFound;
    }

    try {
        return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Preconfiguring: ${scriptFile}`,
                cancellable: true,
            },
            async (progress, cancel) => {
                cancel.onCancellationRequested(() => {
                    progress.report({increment: 1, message: "Cancelling..."});
                    logger.message("The user is cancelling the preconfigure...");
                    logger.message(`Attempting to kill the console process (PID = ${curPID}) and all its children subprocesses...`);
                    util.killTree(curPID);
                    telemetry.logEvent("preconfigureCancelled");
                });

                setIsPreConfiguring(true);
                let retc: number = await runPreconfigureScript(progress, scriptFile || ""); // get rid of || ""

                const telemetryProperties: telemetry.Properties = {
                    exitCode: retc.toString()
                };
                telemetry.logEvent("preConfigure", telemetryProperties);

                return retc;
            },
        );
    } finally {
        setIsPreConfiguring(false);
    }
}

export async function runPreconfigureScript(progress: vscode.Progress<{}>, scriptFile: string): Promise<number> {
    return new Promise<number>(function (resolve, reject): void {
        logger.message(`Preconfiguring...\nScript: "${configuration.getPreconfigureScript()}"`);

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
                progress.report({increment: 1, message: "..."});
            };

            let stderr: any = (result: string): void => {
                stderrStr += result;
            };

            let closing: any = (retCode: number, signal: string): void => {
                if (retCode === ConfigureBuildReturnCodeTypes.success) {
                    logger.message("The pre-configure succeeded.");
                } else {
                    logger.message("The preconfigure script failed. This project may not configure successfully.");
                    logger.message(stderrStr);
                }

                resolve(retCode);
            };

            util.spawnChildProcess(runCommand, scriptArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
        } catch (error) {
            logger.message(error);
            resolve(ConfigureBuildReturnCodeTypes.notFound);
        }
    });
}

export async function configure(updateTargets: boolean = true): Promise<number> {
    // Mark that this workspace had at least one attempt at configuring, before any chance of early return,
    // to accurately identify whether this project configured successfully out of the box or not.
    let ranConfigureBefore: boolean = ext.extension.extensionContext.workspaceState.get<boolean>("ranConfigureBefore") || false;
    ext.extension.extensionContext.workspaceState.update("ranConfigureBefore", true);

    if (blockOperation(Operations.configure)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    // Start the timer that measures how long it takes to configure
    let configureStartTime: number = Date.now();

    let retc: number = 0;
    let preconfigureStatus: string = "not run"; // used for telemetry
    if (configuration.getAlwaysPreconfigure()) {
        retc = await preConfigure();
        preconfigureStatus = `exit code: ${retc}`;
        if (retc !== ConfigureBuildReturnCodeTypes.success) {
            logger.message("Attempting to run configure after a failed preconfigure.");
        }
    }

    try {
        return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Configuring...",
                cancellable: true,
            },
            async (progress, cancel) => {
                cancel.onCancellationRequested(() => {
                    progress.report({increment: 1, message: "Cancelling..."});
                    logger.message(`The user is cancelling the configure during phase "${configureSubPhase}".`);
                    if (curPID !== 0) {
                        logger.message(`Attempting to kill the make process (PID = ${curPID}) and all its children subprocesses...`);
                        util.killTree(curPID);
                    } else {
                        // The configure process may run make twice, with parsing in between and after.
                        // There is also the CppTools IntelliSense custom provider updating awaited
                        // in between the two make invocations.
                        // It is possible that the cancellation may happen when there is no make running.
                        logger.message("curPID is 0, we are in between make invocations.");
                    }

                    // We need this boolean so that doConfigure knows that it needs to stop.
                    // Otherwise, it keeps going even if the make process is killed.
                    // We can't rely on the return code of generateParseContent (which invokes make)
                    // because cancellation may happen right at the end with a successful exit value.
                    cancelConfigure = true;

                    let subphase: string = configureSubPhase;
                    if (recursiveDoConfigure) {
                        subphase += " (reconfigure after automatic reset of build target)";
                    }
                    const telemetryProperties: telemetry.Properties = {
                        phase: subphase
                    };
                    telemetry.logEvent("configureCancelled", telemetryProperties);
                });

                // Identify for telemetry whether this configure will invoke make or will read from a build log or a cache:
                let ranMake: boolean = true;
                let buildLog: string | undefined = configuration.getBuildLog();
                // If build log is set and exists, we are sure make is not getting invoked
                if (buildLog && util.checkFileExistsSync(buildLog)) {
                    ranMake = false;
                } else {
                    // If this is a clean configure and a configuration cache was previously created,
                    // cleanConfigure already deleted it and it will get recreated by doConfigure below,
                    // so checking now on the existence of the configuration cache is a good indication
                    // whether make is going to be invoked or not.
                    let configurationCache: string | undefined = configuration.getConfigurationCache();
                    if (configurationCache && util.checkFileExistsSync(configurationCache)) {
                        ranMake = false;
                    }
                }

                // Identify for telemetry whether:
                //   - this configure will need to double the workload, if it needs to analyze the build targets separately.
                //   - this configure will need to reset the build target to the default, which will need a reconfigure.
                let processTargetsSeparately: boolean = false;
                let currentBuildTarget: string | undefined = configuration.getCurrentTarget();
                let oldBuildTarget: string | undefined = currentBuildTarget;
                if (!currentBuildTarget || currentBuildTarget === "") {
                    currentBuildTarget = "all";
                }
                if (updateTargets && currentBuildTarget !== "all") {
                    processTargetsSeparately = true;
                }

                setIsConfiguring(true);
                retc = await doConfigure(progress, updateTargets);

                let configureEndTime: number = Date.now();
                let configureElapsedTime: number = (configureEndTime - configureStartTime) / 1000;
                const telemetryMeasures: telemetry.Measures = {
                    numberBuildTargets: configuration.getBuildTargets().length,
                    numberLaunchTargets: configuration.getLaunchTargets().length,
                    numberMakefileConfigurations: configuration.getMakefileConfigurations().length
                };
                const telemetryProperties: telemetry.Properties = {
                    exitCode: retc.toString(),
                    firstTime: (!ranConfigureBefore).toString(),
                    elapsedTime: `${configureElapsedTime} (sec)`,
                    ranMake: ranMake.toString(),
                    preconfigure: preconfigureStatus,
                    processTargetsSeparately: processTargetsSeparately.toString(),
                    resetBuildTarget: (oldBuildTarget !== configuration.getCurrentTarget()).toString()
                };
                telemetry.logEvent("configure", telemetryProperties, telemetryMeasures);

                return retc;
            },
        );
    } finally {
        setIsConfiguring(false);
    }
}

// Globals (for now) useful in logging and telemetry of cancelled configure
let configureSubPhase: string = "not started"; // where a cancel happened in the workflow
let cancelConfigure: boolean = false; // when to return early from the configure workflow
let recursiveDoConfigure: boolean = false; // if the current configure is caused by an automatic build target reset

// Update IntelliSense and launch targets with information parsed from a user given build log,
// the dryrun cache or make dryrun output if the cache is not present.
// Sometimes the targets do not need an update (for example, when there has been
// a change in the current build target), as requested through the boolean.
// This saves unnecessary parsing which may be signifficant for very big code bases.
export async function doConfigure(progress: vscode.Progress<{}>, updateTargets: boolean = true): Promise<number> {
    let retc1: number;
    let retc2: number | undefined;
    let retc3: number | undefined;

    // This generates the dryrun output and caches it.
    configureSubPhase = "Generating parse content for IntelliSense and launch targets.";
    retc1 = await generateParseContent(progress);
    if (cancelConfigure) {
        cancelConfigure = false;
        logger.message("Exiting early from the configure process.");
        configuration.setConfigureDirty(true);
        return ConfigureBuildReturnCodeTypes.cancelled;
    }

    // Configure IntelliSense
    configureSubPhase = "Updating CppTools custom IntelliSense provider.";
    logger.message(`Parsing for IntelliSense from: "${parseFile}"`);
    await ext.updateProvider(parseContent || "");

    configureSubPhase = "Parsing launch targets.";

    // Configure launch targets as parsed from the makefile
    // (and not as read from settings via makefile.launchConfigurations).
    logger.message(`Parsing for launch targets from: "${parseFile}"`);
    let launchConfigurations: string[] = [];
    parser.parseForLaunchConfiguration(parseContent || "").forEach(config => {
        launchConfigurations.push(configuration.launchConfigurationToString(config));
    });

    if (launchConfigurations.length === 0) {
        logger.message("No launch configurations have been detected.");
        configuration.setLaunchTargets([]);
    } else {
        // Sort and remove duplicates (different targets may build into the same place,
        // launching doesn't need to know which version of the binary that is).
        launchConfigurations = launchConfigurations.sort().filter(function (elem, index, self): boolean {
            return index === self.indexOf(elem);
        });

        logger.message("Found the following launch targets defined in the makefile: " + launchConfigurations.join(";"));
        configuration.setLaunchTargets(launchConfigurations);
    }

    // Verify if the current launch configuration is still part of the list and unset otherwise.
    let currentLaunchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
    let currentLaunchConfigurationStr: string | undefined = currentLaunchConfiguration ? configuration.launchConfigurationToString(currentLaunchConfiguration) : "";
    if (currentLaunchConfigurationStr !== "" && !launchConfigurations.includes(currentLaunchConfigurationStr)) {
        logger.message(`Current launch configuration ${currentLaunchConfigurationStr} is no longer present in the available list.`);
        configuration.setLaunchConfigurationByName("");
    }

    // Configure build targets only if necessary
    if (updateTargets) {
        // If the current target is other than default (empty "") or "all",
        // we need to generate a different dryrun output
        let target: string | undefined = configuration.getCurrentTarget();
        if (target !== "" && target !== "all") {
            configureSubPhase = "Generating parse content for build targets.";
            retc2 = await generateParseContent(progress, true);
            if (cancelConfigure) {
                cancelConfigure = false;
                logger.message("Exiting early from the configure process.");
                configuration.setConfigureDirty(true);
                return ConfigureBuildReturnCodeTypes.cancelled;
            }

        }

        configureSubPhase = "Parsing build targets.";
        logger.message(`Parsing for build targets from: "${parseFile}"`);
        let buildTargets: string[] = parser.parseTargets(parseContent || "");
        if (buildTargets.length === 0) {
            configuration.setBuildTargets([]);
            logger.message("No build targets have been detected.");
        } else {
            configuration.setBuildTargets(buildTargets.sort());
            logger.message("Found the following build targets defined in the makefile: " + buildTargets.join(";"));
        }

        // Verify if the current build target is still part of the list and unset otherwise.
        let currentBuildTarget: string | undefined = configuration.getCurrentTarget();
        if (currentBuildTarget && currentBuildTarget !== "" && !buildTargets.includes(currentBuildTarget)) {
            logger.message(`Current build target ${currentBuildTarget} is no longer present in the available list.` +
                ` Unsetting the current build target.`);

            // Setting a new target by name is not triggering a configure
            // (only its caller setBuildTarget, invoked by its command or status bar button).
            // But we do need to configure again after a build target change,
            // so call doConfigure here and not configure.
            // We don't need to alter yet any dirty or pending states, this being an 'inner' call of configure.
            // We don't need to consider makefile.configureAfterCommand: even if set to false
            // (which would result in changing a build target without a following configure - in the normal scenario)
            // now we need to configure because this build target reset was done under the covers
            // by the extension and as a result of a configure (which can only be triggered by the user
            // if makefile.configureAfterCommand is set to false).
            // Calling doConfigure here will not result in extra telemetry (just extra logging).
            // The recursive call to doConfigure will fall still under the same progress bar and cancel button
            // as the caller and its result will be included into the telemetry information reported by that.
            // There can be only one level of recursivity because once the target is reset to empty,
            // it is impossible to get into the state of having a target that is not found in the available list.
            configuration.setTargetByName("");
            logger.message("Automatically reconfiguring the project after a build target change.");
            recursiveDoConfigure = true;

            // Ensure the cache is cleaned at this point. Even if the original configure operation
            // was explicitly not clean, resetting the build target requires a clean configure.
            cleanCache();
            retc3 = await doConfigure(progress, updateTargets);
        }
    }

    // If we did have an inner configure invoked (situation identified by having retc3 defined)
    // then it already logged about the status of the operation.
    if (retc3 === undefined) {
        if (retc1 === ConfigureBuildReturnCodeTypes.success &&
            (!retc2 || retc2 === ConfigureBuildReturnCodeTypes.success)) {
            logger.message("Configure succeeded.");
        } else {
            // Do we want to remain dirty in case of failure?
            logger.message("There were errors during the configure process.");
        }
    }

    configuration.setConfigureDirty(false);
    configureSubPhase = "not started";
    recursiveDoConfigure = false;

    // If we have a retc3 result, it doesn't matter what retc1 and retc2 are.
    return (retc3 !== undefined) ? retc3 :
        // Very unlikely to have different return codes for the two make dryrun invocations,
        // since the only diffence is that the last one ensures the target is 'all'
        // instead of a smaller scope target.
        ((retc1 === retc2 || retc2 === undefined) ? retc1 : ConfigureBuildReturnCodeTypes.mixedErr);
}

// Delete the dryrun cache (including targets cache) and configure
function cleanCache(): void {
    let cache: string | undefined = configuration.getConfigurationCache();
    if (cache) {
        if (util.checkFileExistsSync(cache)) {
            logger.message(`Deleting the configuration cache: ${cache}`);
            fs.unlinkSync(cache);
        }

        cache = path.parse(cache).dir;
        cache = path.join(cache, "targetsCache.log");
        if (util.checkFileExistsSync(cache)) {
            logger.message(`Deleting the targets cache: ${cache}`);
            fs.unlinkSync(cache);
        }
    }
}

// Configure after cleaning the cache
export async function cleanConfigure(updateTargets: boolean = true): Promise<number> {
    // Even if the core configure process also checks for blocking operations,
    // verify the same here as well, to make sure that we don't delete the caches
    // only to return early from the core configure.
    if (blockOperation(Operations.configure)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    cleanCache();

    return configure(updateTargets);
}

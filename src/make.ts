// Support for make operations

import * as configuration from './configuration';
import * as cpp from 'vscode-cpptools';
import * as cpptools from './cpptools';
import {extension} from './extension';
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

let configureIsInBackground: boolean = false;
export function getConfigureIsInBackground(): boolean { return configureIsInBackground; }
export function setConfigureIsInBackground(background: boolean): void { configureIsInBackground = background; }

let configureIsClean: boolean = false;
export function getConfigureIsClean(): boolean { return configureIsClean; }
export function setConfigureIsClean(clean: boolean): void { configureIsClean = clean; }

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
    debug = "debug",
    run = "run"
}

export enum TriggeredBy {
    buildTarget = "command pallette (buildTarget)",
    buildCleanTarget = "command pallette (buildCleanTarget)",
    buildAll = "command pallette (buildAll)",
    buildCleanAll = "command pallette (buildCleanAll)",
    preconfigure = "command pallette (preConfigure)",
    alwaysPreconfigure = "settings (alwaysPreConfigure)",
    configure = "command pallette (configure)",
    configureOnOpen = "settings (configureOnOpen)",
    cleanConfigureOnOpen = "configure dirty (on open), settings (configureOnOpen)",
    cleanConfigure = "command pallette (clean configure)",
    configureBeforeBuild = "configure dirty (before build), settings (configureAfterCommand)",
    configureAfterConfigurationChange = "settings (configureAfterCommand), command pallette (setBuildConfiguration)",
    configureAfterEditorFocusChange = "configure dirty (editor focus change), settings (configureOnEdit)",
    configureBeforeTargetChange = "configure dirty (before target change), settings (configureAfterCommand)",
    configureAfterTargetChange = "settings (configureAfterCommand), command pallette (setBuildTarget)",
    configureBeforeLaunchTargetChange = "configureDirty (before launch target change), settings (configureAfterCommand)",
}


let fileIndex: Map<string, cpp.SourceFileConfigurationItem> = new Map<string, cpp.SourceFileConfigurationItem>();
let workspaceBrowseConfiguration: cpp.WorkspaceBrowseConfiguration = { browsePath: [] };
export function getDeltaCustomConfigurationProvider(): cpptools.CustomConfigurationProvider {
    let provider: cpptools.CustomConfigurationProvider = {
        fileIndex: fileIndex,
        workspaceBrowse: workspaceBrowseConfiguration
    };

    return provider;
}
export function setCustomConfigurationProvider(provider: cpptools.CustomConfigurationProvider): void {
    fileIndex = provider.fileIndex;
    workspaceBrowseConfiguration = provider.workspaceBrowse;
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
export function blockedByOp(op: Operations, showPopup: boolean = true): Operations | undefined {
    let blocker: Operations | undefined;

    if (getIsPreConfiguring()) {
        blocker = Operations.preConfigure;
    }

    if (getIsConfiguring()) {
        // A configure in the background shouldn't block anything except another configure
        if (getConfigureIsInBackground() && op !== Operations.configure) {
            vscode.window.showInformationMessage(`The project is configuring in the background and ${op} may run on out-of-date input.`);
        } else {
            blocker = Operations.configure;
        }
    }

    if (getIsBuilding()) {
        blocker = Operations.build;
    }

    if (blocker && showPopup) {
        vscode.window.showErrorMessage(`Cannot "${op}" because the project is already doing a ${blocker}.`);
    }

    return blocker;
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

// Build targets allow list for telemetry
function processTargetForTelemetry(target: string | undefined): string {
    if (!target || target === "") {
        return "(unset)";
    } else if (target === "all" || target === "clean") {
        return target;
    }

    return "..."; // private undisclosed info
}

// PID of the process that may be running currently.
// At any moment, there is either no process or only one process running
// (make for configure, make for build or pre-configure cmd/bash).
// TODO: improve the code regarding curPID and how util.spawnChildProcess is setting it in make.ts unit.
let curPID: number = -1;
export function getCurPID(): number { return curPID; }
export function setCurPID(pid: number): void { curPID = pid; }

export async function buildTarget(triggeredBy: TriggeredBy, target: string, clean: boolean = false): Promise<number> {
    if (blockedByOp(Operations.build)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    // Same start time for build and an eventual configure.
    let buildStartTime: number = Date.now();

    // warn about an out of date configure state and configure if makefile.configureAfterCommand allows.
    let configureExitCode: number | undefined; // used for telemetry
    let configureElapsedTime: number | undefined; // used for telemetry
    if (extension.getState().configureDirty) {
        logger.message("The project needs to configure in order to build properly the current target.");
        if (configuration.getConfigureAfterCommand()) {
            configureExitCode = await configure(TriggeredBy.configureBeforeBuild);
            if (configureExitCode !== ConfigureBuildReturnCodeTypes.success) {
                logger.message("Attempting to run build after a failed configure.");
            }

            configureElapsedTime = util.elapsedTimeSince(buildStartTime);
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

    let cancelBuild: boolean = false; // when the build was cancelled by the user

    try {
        return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: popupStr,
                cancellable: true,
            },
            async (progress, cancel) => {
                cancel.onCancellationRequested(async () => {
                    progress.report({increment: 1, message: "Cancelling..."});
                    logger.message("The user is cancelling the build...");
                    cancelBuild = true;

                    // Kill make and all its children subprocesses.
                    logger.message(`Attempting to kill the make process (PID = ${curPID}) and all its children subprocesses...`);
                    await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Cancelling build",
                            cancellable: false,
                        },
                        async (progress) => {
                            await util.killTree(progress, curPID);
                        });
                });

                setIsBuilding(true);
                let retc: number = await doBuildTarget(progress, target, clean);

                // We need to know whether this build was cancelled by the user
                // more than the real exit code of the make process in this circumstance.
                if (cancelBuild) {
                    retc = ConfigureBuildReturnCodeTypes.cancelled;
                }

                let buildElapsedTime: number = util.elapsedTimeSince(buildStartTime);
                const telemetryProperties: telemetry.Properties = {
                    exitCode: retc.toString(),
                    target: processTargetForTelemetry(target),
                    triggeredBy: triggeredBy
                };
                const telemetryMeasures: telemetry.Measures = {
                    buildTotalElapsedTime: buildElapsedTime
                };

                // Report if this build ran also a configure and how long it took.
                if (configureExitCode !== undefined) {
                    telemetryProperties.configureExitCode = configureExitCode.toString();
                }
                if (configureElapsedTime !== undefined) {
                    telemetryMeasures.configureElapsedTime =  configureElapsedTime;
                }

                telemetry.logEvent("build", telemetryProperties, telemetryMeasures);

                cancelBuild = false;
                return retc;
            },
        );
    } finally {
        setIsBuilding(false);
    }
}

export async function doBuildTarget(progress: vscode.Progress<{}>, target: string, clean: boolean = false): Promise<number> {
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

        const result: util.SpawnProcessResult = await util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr);
        if (result.returnCode !== ConfigureBuildReturnCodeTypes.success) {
            logger.message(`Target ${target} failed to build.`);
        } else {
            logger.message(`Target ${target} built successfully.`);
        }
        return result.returnCode;
    } catch (error) {
        // No need for notification popup, since the build result is visible already in the output channel
        logger.message(error);
        return ConfigureBuildReturnCodeTypes.notFound;
    }
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
export async function generateParseContent(progress: vscode.Progress<{}>,
                                           cancel: vscode.CancellationToken,
                                           forTargets: boolean = false,
                                           recursive: boolean = false): Promise<number> {
    if (cancel.isCancellationRequested) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }

    // Rules for parse content and file:
    //     1. makefile.buildLog provided by the user in settings
    //     2. configuration cache (the previous dryrun output): makefile.configurationCache
    //     3. the make dryrun output if (2) is missing
    // We do not use buildLog for build targets analysis because 
    // we can afford to invoke make -pRrq (very quick even on large projects).
    let buildLog: string | undefined = configuration.getConfigurationBuildLog();
    if (buildLog && !forTargets) {
        parseContent = util.readFile(buildLog);
        if (parseContent) {
            parseFile = buildLog;
            return 0;
        }
    }

    // Continue with the make dryrun invocation
    let makeArgs: string[] = [];

    // Prepend the target to the arguments given in the makefile.configurations object,
    // unless we want to parse for the full set of available targets.
    if (forTargets) {
        makeArgs.push("all");
    } else {
        let currentTarget: string | undefined = configuration.getCurrentTarget();
        if (currentTarget) {
            makeArgs.push(currentTarget);
        }
    }

    // Include all the make arguments defined in makefile.configurations.makeArgs
    makeArgs = makeArgs.concat(configuration.getConfigurationMakeArgs());

    // If we are analyzing build targets, we need the following switches:
    //  --print-data-base (which generates verbose output where we parse targets from).
    // --no-builtin-variables and --no-builtin-rules (to reduce the size of the
    // output produced by --print-data-base and also to obtain a list of targets
    // that make sense, skipping over implicit targets like objects from sources
    // or binaries from objects and libs).
    // --question (to not execute anything, for us equivalent of dry-run
    // but without printing commands, which contributes again to a smaller output).
    // If we are analyzing compiler/linker commands for IntelliSense and launch targets,
    // we use --dry-run and anything from makefile.dryrunSwitches.
    const dryrunSwitches: string[] | undefined = configuration.getDryrunSwitches();
    if (forTargets) {
        makeArgs.push("--print-data-base");
        makeArgs.push("--no-builtin-variables");
        makeArgs.push("--no-builtin-rules");
        makeArgs.push("--question");
        logger.messageNoCR("Generating targets information with command: ");
    } else {
        makeArgs.push("--dry-run");

        // If this is not a clean configure, remove --always-make from the arguments list.
        // We need to have --always-make in makefile.dryrunSwitches and remove it for not clean configure
        // (as opposed to not having --always-make in makefile.dryrunSwitches and adding it for clean configure)
        // because we want to avoid having 2 dryrun switches settings (one for clean and one for not clean configure)
        // and also because the user needs to be able to remove --always-make from any make --dry-run invocation,
        // if it causes trouble.
        dryrunSwitches?.forEach(sw => {
            if (getConfigureIsClean() || (sw !== "--always-make" && sw !== "-B")) {
                makeArgs.push(sw);
            }
        });

        logger.messageNoCR("Generating configuration cache with command: ");
    }

    logger.message(configuration.getConfigurationMakeCommand() + " " + makeArgs.join(" "));

    try {
        let dryrunFile : string = util.resolvePathToRoot(forTargets ? "./pRrq.log" : "./dryrun.log");
        logger.message(`Writing the dry-run output: ${dryrunFile}`);
        util.writeFile(dryrunFile, configuration.getConfigurationMakeCommand() + " " + makeArgs.join(" ") + "\r\n");

        let stdoutStr: string = "";
        let stderrStr: string = "";

        let stdout: any = (result: string): void => {
            stdoutStr += result;
            fs.appendFileSync(dryrunFile, `${result} \r\n`);
            progress.report({increment: 1, message: "Generating dry-run output" +
                                                    ((recursive) ? " (recursive)" : "") +
                                                    ((forTargets) ? " (for targets specifically)" : "" +
                                                    "...")});
        };

        let stderr: any = (result: string): void => {
            fs.appendFileSync(dryrunFile, `${result} \r\n`);
            stderrStr += result;
        };

        let startTime: number = Date.now();
        const result: util.SpawnProcessResult = await util.spawnChildProcess(configuration.getConfigurationMakeCommand(), makeArgs, vscode.workspace.rootPath || "", stdout, stderr);
        let elapsedTime: number = util.elapsedTimeSince(startTime);
        logger.message(`Generating dry-run elapsed time: ${elapsedTime}`);

        parseFile = dryrunFile;
        parseContent = stdoutStr;

        // The error codes returned by the targets invocation (make -pRrq) mean something else
        // (for example if targets are out of date). We can ignore the return code for this
        // because it "can't fail". It represents only display of database and no targets are actually run.
        // try syntax error
        if (result.returnCode !== ConfigureBuildReturnCodeTypes.success && forTargets !== true) {
            logger.message("The make dry-run command failed.");
            logger.message("IntelliSense may work only partially or not at all.");
            logger.message(stderrStr);

            // Report the standard dry-run error & guide only when the configure was not cancelled
            // by the user (which causes retCode to be null).
            // Also don't write the cache if this operation was cancelled
            // because it may be incomplete and affect a future non clean configure.
            if (result.returnCode !== null) {
                util.reportDryRunError(dryrunFile);
            }
        }

        curPID = -1;
        return result.returnCode;
    } catch (error) {
        logger.message(error);
        return ConfigureBuildReturnCodeTypes.notFound;
    }
}

export async function preConfigure(triggeredBy: TriggeredBy): Promise<number> {
    if (blockedByOp(Operations.preConfigure)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    let preConfigureStartTime: number = Date.now();

    let scriptFile: string | undefined = configuration.getPreConfigureScript();
    if (!scriptFile) {
        vscode.window.showErrorMessage("Pre-configure failed: no script provided.");
        logger.message("No pre-configure script is set in settings. " +
                       "Make sure a pre-configuration script path is defined with makefile.preConfigureScript.");
        return ConfigureBuildReturnCodeTypes.notFound;
    }

    if (!util.checkFileExistsSync(scriptFile)) {
        vscode.window.showErrorMessage("Could not find pre-configure script.");
        logger.message(`Could not find the given pre-configure script "${scriptFile}" on disk. `);
        return ConfigureBuildReturnCodeTypes.notFound;
    }

    let cancelPreConfigure: boolean = false; // when the pre-configure was cancelled by the user

    try {
        return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Pre-configuring: ${scriptFile}`,
                cancellable: true,
            },
            async (progress, cancel) => {
                cancel.onCancellationRequested(async () => {
                    progress.report({increment: 1, message: "Cancelling..."});
                    cancelPreConfigure = true;

                    logger.message("The user is cancelling the pre-configure...");
                    logger.message(`Attempting to kill the console process (PID = ${curPID}) and all its children subprocesses...`);
                    await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Cancelling pre-configure",
                            cancellable: false,
                        },
                        async (progress) => {
                            await util.killTree(progress, curPID);
                        });
                });

                setIsPreConfiguring(true);
                let retc: number = await runPreConfigureScript(progress, scriptFile || ""); // get rid of || ""

                // We need to know whether this pre-configure was cancelled by the user
                // more than the real exit code of the pr-econfigure script in this circumstance.
                if (cancelPreConfigure) {
                    retc = ConfigureBuildReturnCodeTypes.cancelled;
                }

                let preConfigureElapsedTime: number = util.elapsedTimeSince(preConfigureStartTime);
                const telemetryMeasures: telemetry.Measures = {
                    preConfigureElapsedTime: preConfigureElapsedTime
                };
                const telemetryProperties: telemetry.Properties = {
                    exitCode: retc.toString(),
                    triggeredBy: triggeredBy
                };
                telemetry.logEvent("preConfigure", telemetryProperties, telemetryMeasures);

                cancelPreConfigure = false;
                return retc;
            },
        );
    } finally {
        setIsPreConfiguring(false);
    }
}

// Applies to the current process all the environment variables that resulted from the pre-configure step.
// The input 'content' represents the output of a command that lists all the environment variables:
// set on windows or printenv on linux/mac.
async function applyEnvironment(content: string | undefined) : Promise<void> {
    let lines: string[] = content?.split(/\r?\n/) || [];
    lines.forEach(line => {
        let eqPos: number = line.search("=");
        let envVarName: string = line.substring(0, eqPos);
        let envVarValue: string = line.substring(eqPos + 1, line.length);
        process.env[envVarName] = envVarValue;
    });
}

export async function runPreConfigureScript(progress: vscode.Progress<{}>, scriptFile: string): Promise<number> {
    logger.message(`Pre-configuring...\nScript: "${configuration.getPreConfigureScript()}"`);

    // Create a temporary wrapper for the user pre-configure script so that we collect
    // in another temporary output file the environrment variables that were produced.
    let wrapScriptFile: string = path.join(util.tmpDir(), "wrapPreconfigureScript");
    let wrapScriptOutFile: string = wrapScriptFile + ".out";
    let wrapScriptContent: string;
    if (process.platform === "win32") {
        wrapScriptContent = `call ${scriptFile}\r\n`;
        wrapScriptContent += `set > ${wrapScriptOutFile}`;
        wrapScriptFile += ".bat";
    } else {
        wrapScriptContent = `source ${scriptFile}\n`;
        wrapScriptContent += `printenv > ${wrapScriptOutFile}`;
        wrapScriptFile += ".sh";
    }

    util.writeFile(wrapScriptFile, wrapScriptContent);

    let scriptArgs: string[] = [];
    let runCommand: string;
    if (process.platform === 'win32') {
        runCommand = "cmd";
        scriptArgs.push("/c");
        scriptArgs.push(wrapScriptFile);
    } else {
        runCommand = "/bin/bash";
        scriptArgs.push("-c");
        scriptArgs.push(`"source ${wrapScriptFile}"`);
    }

    try {
        let stdout: any = (result: string): void => {
            progress.report({increment: 1, message: "..."});
            logger.messageNoCR(result);
        };

        let stderr: any = (result: string): void => {
            logger.messageNoCR(result);
        };

        const result: util.SpawnProcessResult = await util.spawnChildProcess(runCommand, scriptArgs, vscode.workspace.rootPath || "", stdout, stderr);
        if (result.returnCode === ConfigureBuildReturnCodeTypes.success) {
            logger.message("The pre-configure succeeded.");
        } else {
            logger.message("The pre-configure script failed. This project may not configure successfully.");
        }

        // Apply the environment produced by running the pre-configure script.
        applyEnvironment(util.readFile(wrapScriptOutFile));

        return result.returnCode;
    } catch (error) {
        logger.message(error);
        return ConfigureBuildReturnCodeTypes.notFound;
    }
}

interface ConfigurationCacheContent {
    buildTargets: string[];
    launchTargets: string[];
    customConfigurationProvider: cpptools.CustomConfigurationProvider;
}

// A non clean configure loads first any pre-existing cache, so that the user
// has IntelliSense and build/launch targets available earlier.
// Then invokes make dry-run (without --always-make which is used for clean configure only)
// or reads from a provided build log and parses new content to be added to the configuration cache.
// The configuration cache content and the CppTools custom IntelliSense provider are not reset.
// This way we can add incrementally to what has been parsed from the previous clean configure.
// There is the downside that any files that are removed from the makefile
// (thus disappearing from the log with commands) will still have IntelliSense loaded
// until the next clean configure.
export async function configure(triggeredBy: TriggeredBy, updateTargets: boolean = true): Promise<number> {
    // Mark that this workspace had at least one attempt at configuring, before any chance of early return,
    // to accurately identify whether this project configured successfully out of the box or not.
    let ranConfigureInCodebaseLifetime: boolean = extension.getState().ranConfigureInCodebaseLifetime;
    extension.getState().ranConfigureInCodebaseLifetime = true;

    if (blockedByOp(Operations.configure)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    // Same start time for configure and an eventual pre-configure.
    let configureStartTime: number = Date.now();

    let preConfigureExitCode: number | undefined; // used for telemetry
    let preConfigureElapsedTime: number | undefined; // used for telemetry
    if (configuration.getAlwaysPreConfigure()) {
        preConfigureExitCode = await preConfigure(TriggeredBy.alwaysPreconfigure);
        if (preConfigureExitCode !== ConfigureBuildReturnCodeTypes.success) {
            logger.message("Attempting to run configure after a failed pre-configure.");
        }

        preConfigureElapsedTime = util.elapsedTimeSince(configureStartTime);
    }

    // Identify for telemetry whether this configure will invoke make --dry-run or will read from a build log
    // If a build log is set and it exists, we are sure make --dry-run is not getting invoked.
    let makeDryRun: boolean = true;
    let buildLog: string | undefined = configuration.getConfigurationBuildLog();
    if (buildLog && util.checkFileExistsSync(buildLog)) {
        makeDryRun = false;
    }

    // Identify for telemetry whether this configure will read configuration constructs from cache.
    let readCache: boolean = false;
    let configurationCache: string | undefined = configuration.getConfigurationCache();
    if (configurationCache && util.checkFileExistsSync(configurationCache)) {
        readCache = true;
    }; 
    
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

    let retc: number = ConfigureBuildReturnCodeTypes.mixedErr;
    try {
        return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Configuring",
                cancellable: true,
            },
            (progress, cancel) => {
                cancel.onCancellationRequested(async () => {
                    if (curPID !== -1) {
                        logger.message(`Attempting to kill the make process (PID = ${curPID}) and all its children subprocesses...`);
                        await vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: "Cancelling configure",
                                cancellable: false,
                            },
                            async (progress) => {
                                return util.killTree(progress, curPID);
                            });
                    } else {
                        // The configure process may run make twice (or three times if the build target is reset),
                        // with parsing in between and after. There is also the CppTools IntelliSense custom provider update
                        // awaiting at various points. It is possible that the cancellation may happen when there is no make running.
                        logger.message("curPID is 0, we are in between make invocations.");
                    }

                    logger.message("Exiting early from the configure process.");

                    // We want a successful configure as soon as possible.
                    // The dirty state can help with that by triggering a new configure
                    // when the next relevant command occurs.
                    extension.getState().configureDirty = true;

                    retc = ConfigureBuildReturnCodeTypes.cancelled;
                    setIsConfiguring(false);
                    setConfigureIsClean(false);
                    setConfigureIsInBackground(false);
                });

                setIsConfiguring(true);

                return doConfigure(progress, cancel, updateTargets);
            },
        );
    } catch (e) {
        logger.message(e.message);
        return retc;
    } finally {
        let provider: cpptools.CustomConfigurationProvider = extension.getCppConfigurationProvider().getCustomConfigurationProvider();
        let configurationCacheContent: any = {
            buildTargets: configuration.getBuildTargets(),
            launchTargets: configuration.getLaunchTargets(),
            customConfigurationProvider: {
                workspaceBrowse: provider.workspaceBrowse,
                // trick to serialize a map in a JSON
                fileIndex: Array.from(provider.fileIndex)
            }
        };

        // Rewrite the configuration cache according to the last updates of the internal arrays,
        // but not if the configure was cancelled.
        if (configurationCache && retc !== ConfigureBuildReturnCodeTypes.cancelled) {
            util.writeFile(configurationCache, JSON.stringify(configurationCacheContent));
        }

        let newBuildTarget: string | undefined = configuration.getCurrentTarget();
        let configureElapsedTime: number = util.elapsedTimeSince(configureStartTime);
        const telemetryMeasures: telemetry.Measures = {
            numberBuildTargets: configuration.getBuildTargets().length,
            numberLaunchTargets: configuration.getLaunchTargets().length,
            numberMakefileConfigurations: configuration.getMakefileConfigurations().length,
            totalElapsedTime: configureElapsedTime
        };
        const telemetryProperties: telemetry.Properties = {
            exitCode: retc.toString(),
            firstTime: (!ranConfigureInCodebaseLifetime).toString(),
            makeDryRun: makeDryRun.toString(),
            readCache: readCache.toString(),
            isClean: getConfigureIsClean().toString(),
            processTargetsSeparately: processTargetsSeparately.toString(),
            resetBuildTarget: (oldBuildTarget !== newBuildTarget).toString(),
            triggeredBy: triggeredBy
        };

        // Report if this configure ran also a pre-configure and how long it took.
        if (preConfigureExitCode !== undefined) {
            telemetryProperties.preConfigureExitCode = preConfigureExitCode.toString();
        }
        if (preConfigureElapsedTime !== undefined) {
            telemetryMeasures.preConfigureElapsedTime =  preConfigureElapsedTime;
            logger.message(`Preconfigure elapsed time: ${preConfigureElapsedTime}`);
        }

        telemetryProperties.buildTarget = processTargetForTelemetry(newBuildTarget);
        telemetry.logEvent("configure", telemetryProperties, telemetryMeasures);

        logger.message(`Configure elapsed time: ${configureElapsedTime}`);

        setIsConfiguring(false);
        setConfigureIsClean(false);
        setConfigureIsInBackground(false);
    }
}

async function parseLaunchConfigurations(progress: vscode.Progress<{}>, cancel: vscode.CancellationToken,
                                         dryRunOutput: string, recursive: boolean = false): Promise<number> {

    if (cancel.isCancellationRequested) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }

    let launchConfigurations: configuration.LaunchConfiguration[] = [];

    let onStatus: any = (status: string): void => {
        progress.report({ increment: 1, message: status + ((recursive) ? "(recursive)" : "" + "...") });
    };

    let onFoundLaunchConfiguration: any = (launchConfiguration: configuration.LaunchConfiguration): void => {
        launchConfigurations.push(launchConfiguration);
    };

    let retc: number = await parser.parseLaunchConfigurations(cancel, dryRunOutput, onStatus, onFoundLaunchConfiguration);
    if (retc === ConfigureBuildReturnCodeTypes.success) {
        let launchConfigurationsStr: string[] = [];
        launchConfigurations.forEach(config => {
            launchConfigurationsStr.push(configuration.launchConfigurationToString(config));
        });

        if (launchConfigurationsStr.length === 0) {
            logger.message("No" + (getConfigureIsClean() ? "" : "new") + " launch configurations have been detected.");
        } else {
            // Sort and remove duplicates that can be created in the following scenarios:
            //    - the same target binary invoked several times with the same arguments and from the same path
            //    - a target binary invoked once with no parameters is still a duplicate
            //      of the entry generated by the linker command which produced the binary
            //    - sometimes the same binary is linked more than once in the same location
            //      (example: instrumentation) but the launch configurations list need only one entry,
            //      corresponding to the final binary, not the intermediate ones.
            launchConfigurationsStr = util.sortAndRemoveDuplicates(launchConfigurationsStr);

            logger.message("Found the following" + (getConfigureIsClean() ? "" : "new") + " launch targets defined in the makefile: " + launchConfigurationsStr.join(";"));
        }

        if (getConfigureIsClean()) {
            // If configure is clean, delete any old launch targets found previously.
            configuration.setLaunchTargets(launchConfigurationsStr);
        } else {
            // If we're merging with a previous set of launch targets,
            // remove duplicates because sometimes, depending how the makefiles are set up,
            // a non --always-make dry-run may still log commands for up to date files.
            // These would be found also in the previous list of launch targets.
            configuration.setLaunchTargets(util.sortAndRemoveDuplicates(configuration.getLaunchTargets().concat(launchConfigurationsStr)));
        }

        logger.message(`Complete list of launch targets: ${configuration.getLaunchTargets().join(";")}`);
    }

    return retc;
}

async function parseTargets(progress: vscode.Progress<{}>, cancel: vscode.CancellationToken,
                            dryRunOutput: string, recursive: boolean = false): Promise<number> {

    if (cancel.isCancellationRequested) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }


    let targets: string[] = [];

    let onStatus: any = (status: string): void => {
        progress.report({ increment: 1, message: status + ((recursive) ? "(recursive)" : "") });
    };

    let onFoundTarget: any = (target: string): void => {
        targets.push(target);
    };

    let retc: number = await parser.parseTargets(cancel, dryRunOutput, onStatus, onFoundTarget);
    if (retc === ConfigureBuildReturnCodeTypes.success) {
        if (targets.length === 0) {
            logger.message("No" + (getConfigureIsClean() ? "" : "new") + "build targets have been detected.");
        } else {
            targets = targets.sort();
            logger.message("Found the following" + (getConfigureIsClean() ? "" : "new") + " build targets defined in the makefile: " + targets.join(";"));
        }

        if (getConfigureIsClean()) {
            // If configure is clean, delete any old build targets found previously.
            configuration.setBuildTargets(targets);
        } else {
            // If we're merging with a previous set of build targets,
            // remove duplicates because sometimes, depending how the makefiles are set up,
            // a non --always-make dry-run may still log commands for up to date files.
            // These would be found also in the previous list of build targets.
            configuration.setBuildTargets(util.sortAndRemoveDuplicates(configuration.getBuildTargets().concat(targets)));
        }

        logger.message(`Complete list of build targets: ${configuration.getBuildTargets().join(";")}`);
    }

    return retc;
}

async function updateProvider(progress: vscode.Progress<{}>, cancel: vscode.CancellationToken,
                              dryRunOutput: string, recursive: boolean = false): Promise<number> {
    if (cancel.isCancellationRequested) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }

    logger.message("Updating the CppTools IntelliSense Configuration Provider." + ((recursive) ? "(recursive)" : ""));

    let onStatus: any = (status: string): void => {
        progress.report({ increment: 1, message: status + ((recursive) ? "(recursive)" : "" + "...") });
    };

    let onFoundCustomConfigProviderItem: any = (customConfigProviderItem: parser.CustomConfigProviderItem): void => {
        // Configurations parsed from dryrun output or build log are saved temporarily in the delta file index
        extension.buildCustomConfigurationProvider(customConfigProviderItem);
    };

    // Empty the cummulative browse path before we start a new parse for custom configuration.
    // We can empty even if the configure is not clean, because the new browse paths will be appended
    // to the previous browse paths.
    extension.clearCummulativeBrowsePath();
    let retc: number = await parser.parseCustomConfigProvider(cancel, dryRunOutput, onStatus, onFoundCustomConfigProviderItem);
    if (retc !== ConfigureBuildReturnCodeTypes.cancelled) {
        // If this configure is clean, overwrite the final file index, otherwise merge with it.
        let provider: cpptools.CustomConfigurationProvider = getDeltaCustomConfigurationProvider();
        extension.getCppConfigurationProvider().mergeCustomConfigurationProvider(provider);

        // Empty the 'delta' configurations.
        provider.fileIndex.clear();
        provider.workspaceBrowse = {
            browsePath: [],
            compilerArgs: [],
            compilerPath: undefined,
            standard: undefined,
            windowsSdkVersion: undefined
        }
        setCustomConfigurationProvider(provider);

        extension.updateCppToolsProvider();
    }

    return retc;
}

export async function preprocessDryRun(progress: vscode.Progress<{}>, cancel: vscode.CancellationToken,
                                       dryrunOutput: string, recursive: boolean = false): Promise<parser.PreprocessDryRunOutputReturnType> {
    if (cancel.isCancellationRequested) {
        return {retc: ConfigureBuildReturnCodeTypes.cancelled, result: ""};
    }

    let onStatus: any = (status: string): void => {
        progress.report({ increment: 1, message: status + ((recursive) ? "(recursive)" : "" + "...") });
    };

    return await parser.preprocessDryRunOutput(cancel, dryrunOutput, onStatus);
}

export async function loadConfigurationFromCache(progress: vscode.Progress<{}>, cancel: vscode.CancellationToken): Promise<number> {
    if (cancel.isCancellationRequested) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }

    let startTime: number = Date.now();
    let elapsedTime: number;

    await util.scheduleTask(() => {extension.registerCppToolsProvider()});
    let cache: string | undefined = configuration.getConfigurationCache();
    if (cache) {
        let content: string | undefined = util.readFile(cache);
        if (content) {
            try {
                progress.report({ increment: 1, message: "Configuring from cache" });
                logger.message(`Configuring from cache: ${cache}`);
                let configurationCacheContent: any = {
                    buildTargets: [],
                    launchTargets: [],
                    customConfigurationProvider: {
                        workspaceBrowse: [],
                        fileIndex: []
                    }
                };
                configurationCacheContent = JSON.parse(content);

                await util.scheduleTask(() => {
                    configuration.setBuildTargets(configurationCacheContent.buildTargets);
                    configuration.setLaunchTargets(configurationCacheContent.launchTargets);

                    // The configurations saved in the cache are read directly into the final file index.
                    extension.getCppConfigurationProvider().setCustomConfigurationProvider({
                        workspaceBrowse: configurationCacheContent.customConfigurationProvider.workspaceBrowse,
                        // Trick to read a map from json
                        fileIndex: new Map(configurationCacheContent.customConfigurationProvider.fileIndex)
                    });
                });

                // Log all the files read from cache after elapsed time is calculated.
                // IntelliSense should be available by now for all files.
                await util.scheduleTask(() => {
                    extension.getCppConfigurationProvider().logConfigurationProviderComplete();
                });
            } catch (e) {
                logger.message("An error occured while parsing the configuration cache.");
                logger.message("Running clean configure instead.");
                setConfigureIsInBackground(false);
                setConfigureIsClean(true);
            }

            elapsedTime = util.elapsedTimeSince(startTime);
            logger.message(`Load configuration from cache elapsed time: ${elapsedTime}`);
        } else {
            return ConfigureBuildReturnCodeTypes.notFound;
        }
    } else {
        return ConfigureBuildReturnCodeTypes.notFound;
    }

    return cancel.isCancellationRequested ? ConfigureBuildReturnCodeTypes.cancelled : ConfigureBuildReturnCodeTypes.success;
}

// Update IntelliSense and launch targets with information parsed from a user given build log,
// the dryrun cache or make dryrun output if the cache is not present.
// Sometimes the targets do not need an update (for example, when there has been
// a change in the current build target), as requested through the boolean.
// This saves unnecessary parsing which may be signifficant for very big code bases.
export async function doConfigure(progress: vscode.Progress<{}>, cancel: vscode.CancellationToken, updateTargets: boolean = true, recursiveDoConfigure: boolean = false): Promise<number> {
    let retc1: number = ConfigureBuildReturnCodeTypes.mixedErr;
    let retc2: number | undefined;
    let retc3: number | undefined;

    let startTime: number = Date.now();
    let elapsedTime: number;

    // Configure does not start in the background (we have to load a configuration cache first).
    setConfigureIsInBackground(false);

    // If available, load all the configure constructs via json from the cache file.
    // If this doConfigure is in level 1 of recursion, avoid loading the configuration cache again
    // since it's been done at recursion level 0.
    // Also, if this is not the first configure in the VSCode session, also skip
    // because the bulk is already loaded.
    if (!recursiveDoConfigure && !extension.getRanConfigureInSession()) {
        retc1 = await loadConfigurationFromCache(progress, cancel);
        if (retc1 === ConfigureBuildReturnCodeTypes.cancelled) {
            return retc1;
        } else if (retc1 === ConfigureBuildReturnCodeTypes.success) {
            // In case of success, the following configure steps should not block any other operation
            // and can be performed in the background.
            setConfigureIsInBackground(true);
        }
    }

    // This generates the dryrun output (saving it on disk) or reads an alternative build log.
    // Timings for this sub-phase happen inside.
    retc1 = await generateParseContent(progress, cancel, false, recursiveDoConfigure);
    if (retc1 === ConfigureBuildReturnCodeTypes.cancelled) {
        return retc1;
    }

    // Some initial preprocessing required before any parsing is done.
    startTime = Date.now();
    logger.message(`Preprocessing: "${parseFile}"`);
    let preprocessedDryrunOutput: string;
    let preprocessedDryrunOutputResult: parser.PreprocessDryRunOutputReturnType = await preprocessDryRun(progress, cancel, parseContent || "", recursiveDoConfigure);
    if (preprocessedDryrunOutputResult.result) {
        preprocessedDryrunOutput = preprocessedDryrunOutputResult.result;
    } else {
        return preprocessedDryrunOutputResult.retc;
    }
    elapsedTime = util.elapsedTimeSince(startTime);
    logger.message(`Preprocess elapsed time: ${elapsedTime}`);

    // Configure IntelliSense
    // Don't override retc1, since make invocations may fail with errors different than cancel
    // and we still complete the configure process.
    startTime = Date.now();
    logger.message("Parsing for IntelliSense.");
    if (await updateProvider(progress, cancel, preprocessedDryrunOutput, recursiveDoConfigure) === ConfigureBuildReturnCodeTypes.cancelled) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }
    elapsedTime = util.elapsedTimeSince(startTime);
    logger.message(`Parsing for IntelliSense elapsed time: ${elapsedTime}`);

    // Configure launch targets as parsed from the makefile
    // (and not as read from settings via makefile.launchConfigurations).
    startTime = Date.now();
    logger.message(`Parsing for launch targets.`);
    if (await parseLaunchConfigurations(progress, cancel, preprocessedDryrunOutput, recursiveDoConfigure) === ConfigureBuildReturnCodeTypes.cancelled) {
        return ConfigureBuildReturnCodeTypes.cancelled;
    }
    elapsedTime = util.elapsedTimeSince(startTime);
    logger.message(`Parsing for launch targets elapsed time: ${elapsedTime}`);

    // Verify if the current launch configuration is still part of the list and unset otherwise.
    // By this point, configuration.getLaunchTargets() contains a comlete list (old and new).
    let currentLaunchConfiguration: configuration.LaunchConfiguration | undefined = configuration.getCurrentLaunchConfiguration();
    let currentLaunchConfigurationStr: string | undefined = currentLaunchConfiguration ? configuration.launchConfigurationToString(currentLaunchConfiguration) : "";
    if (currentLaunchConfigurationStr !== "" &&
        !configuration.getLaunchTargets().includes(currentLaunchConfigurationStr)) {
            logger.message(`Current launch configuration ${currentLaunchConfigurationStr} is no longer present in the available list.`);
            configuration.setLaunchConfigurationByName("");
    }

    // Configure build targets only if necessary:
    // if the caller considers we need a build target update
    // or if the build target array hasn't been populated by now
    // or if it contains only 'all' which we push automatically.
    let buildTargets: string[] = configuration.getBuildTargets();
    if (updateTargets || buildTargets.length === 0 ||
        (buildTargets.length === 1 && buildTargets[0] === "all")) {
        logger.message("Generating parse content for build targets.");
        retc2 = await generateParseContent(progress, cancel, true, recursiveDoConfigure);
        if (retc2 === ConfigureBuildReturnCodeTypes.cancelled) {
            return retc2;
        }

        startTime = Date.now();
        logger.message(`Parsing for build targets from: "${parseFile}"`);
        if (await parseTargets(progress, cancel, parseContent || "", recursiveDoConfigure) === ConfigureBuildReturnCodeTypes.cancelled) {
            return ConfigureBuildReturnCodeTypes.cancelled;
        }
        elapsedTime = util.elapsedTimeSince(startTime);
        logger.message(`Parsing build targets elapsed time: ${elapsedTime}`);

        // Verify if the current build target is still part of the list and unset otherwise.
        // By this point, configuration.getBuildTargets() contains a comlete list (old and new).
        buildTargets = configuration.getBuildTargets();
        let currentBuildTarget: string | undefined = configuration.getCurrentTarget();
        if (currentBuildTarget && currentBuildTarget !== "" && currentBuildTarget !== "all" &&
            !buildTargets.includes(currentBuildTarget)) {
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

            // This one level recursive doConfigure will keep the same clean state as the caller
            // since setConfigureIsClean runs before the caller configure and resets after
            // the eventual recursive configure.
            retc3 = await doConfigure(progress, cancel, updateTargets, true);
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

    extension.getState().configureDirty = false;
    extension.setCompletedConfigureInSession(true);

    // If we have a retc3 result, it doesn't matter what retc1 and retc2 are.
    return (retc3 !== undefined) ? retc3 :
        // Very unlikely to have different return codes for the two make dryrun invocations,
        // since the only diffence is that the last one ensures the target is 'all'
        // instead of a smaller scope target.
        ((retc1 === retc2 || retc2 === undefined) ? retc1 : ConfigureBuildReturnCodeTypes.mixedErr);
}

// A clean configure = a non clean configure + empty the CppTools custom IntelliSense config provider.
// In the case of a dry-run setting (not a build log) it also means adding --always-make to the make invocation.
// Because we want to first read any existing cache and let the remaining heavy processing run in the background,
// we don't delete the cache here. We just mark it to be later deleted by the non clean configure.
export async function cleanConfigure(triggeredBy: TriggeredBy, updateTargets: boolean = true): Promise<number> {
    // Even if the core configure process also checks for blocking operations,
    // verify the same here as well, to make sure that we don't delete the caches
    // only to return early from the core configure.
    if (blockedByOp(Operations.configure)) {
        return ConfigureBuildReturnCodeTypes.blocked;
    }

    setConfigureIsClean(true);

    return configure(triggeredBy, updateTargets);
}

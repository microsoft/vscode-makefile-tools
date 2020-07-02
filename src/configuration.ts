// Configuration support

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as logger from './logger';
import * as make from './make';
import * as parser from './parser';
import * as ui from './ui';
import * as util from './util';
import * as vscode from 'vscode';
import * as path from 'path';

let statusBar: ui.UI = ui.getUI();

// Each different scenario of building the same makefile, in the same environment, represents a configuration.
// Example: "make BUILD_TYPE=Debug" and "make BUILD_TYPE=Release" can be the debug and release configurations.
// The user can save several different such configurations in makefile.configurations setting,
// from which one can be picked via this extension and saved in settings.

// Priority rules for where is the Makefile Tools extension parsing the needed information from:
//    1. makefile.configurations.buildLog setting
//    2. makefile.buildLog setting
//    3. makefile.configurations.makePath, makefile.configurations.makeArgs
//    4. makefile.makePath and default args
//    5. default make tool and args

export interface MakefileConfiguration {
    // A name associated with a particular build command process and args/options
    name: string;

    // The path (full or relative to the workspace folder) to the makefile
    makefilePath?: string;

    // make, nmake, specmake...
    // This is sent to spawnChildProcess as process name
    // It can have full path, relative path to the workspace folder or only tool name
    // Don't include args in makePath
    makePath?: string;

    // options used in the build invocation
    // don't use more than one argument in a string
    makeArgs?: string[];

    // a pre-generated build log, from which it is preffered to parse from,
    // instead of the dry-run output of the make tool
    buildLog?: string;

    // TODO: investigate how flexible this is to integrate with other build systems than the MAKE family
    // (basically anything that can produce a dry-run output is sufficient)
    // Implement set-able dry-run, verbose, change-directory and always-make switches
    // since different tools may use different arguments for the same behavior
}

// Last configuration name picked from the set defined in makefile.configurations setting.
// Saved into the settings storage. Also reflected in the configuration status bar button.
// If no particular current configuration is defined in settings, set to 'Default'.
let currentMakefileConfiguration: string;
export function getCurrentMakefileConfiguration(): string { return currentMakefileConfiguration; }
export function setCurrentMakefileConfiguration(configuration: string): void {
    currentMakefileConfiguration = configuration;
    statusBar.setConfiguration(currentMakefileConfiguration);
    logger.message("Setting configuration - " + currentMakefileConfiguration);
    getCommandForConfiguration(currentMakefileConfiguration);
    getBuildLogForConfiguration(currentMakefileConfiguration);
}

// Read the current configuration from settings storage, update status bar item
function readCurrentMakefileConfiguration(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    let buildConfiguration : string | undefined = workspaceConfiguration.get<string>("buildConfiguration");
    if (!buildConfiguration) {
        logger.message("No current configuration is defined in the settings file. Assuming 'Default'.", "verbose");
        currentMakefileConfiguration = "Default";
    } else {
        currentMakefileConfiguration = buildConfiguration;
    }

    statusBar.setConfiguration(currentMakefileConfiguration);
}

let makePath: string | undefined;
export function getMakePath(): string | undefined { return makePath; }
export function setMakePath(path: string): void { makePath = path; }

// Read the path (full or directory only) of the make tool if defined in settings.
// It represents a default to look for if no other path is already included
// in "makefile.configurations.makePath".
function readMakePath(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    makePath = workspaceConfiguration.get<string>("makePath");
    if (!makePath) {
        logger.message("No path to the make tool is defined in the settings file", "verbose");
    }
}

let makefilePath: string | undefined;
export function getMakefilePath(): string | undefined { return makefilePath; }
export function setMakefilePath(path: string): void { makefilePath = path; }
// Read the full path to the makefile if defined in settings.
// It represents a default to look for if no other makefile is already provided
// in makefile.configurations.makefilePath.
// TODO: validate and integrate with "-f [Makefile]" passed in makefile.configurations.makeArgs.
function readMakefilePath(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    makefilePath = workspaceConfiguration.get<string>("makefilePath");
    if (!makefilePath) {
        logger.message("No path to the make tool is defined in the settings file", "verbose");
    }
}

let buildLog: string | undefined;
export function getBuildLog(): string | undefined { return buildLog; }
export function setBuildLog(path: string): void { buildLog = path; }

// Read from settings the path of the build log that is desired to be parsed
// instead of a dry-run command output.
// Useful for complex, tricky and corner case repos for which make --dry-run
// is not working as the extension expects.
// Example: --dry-run actually running configure commands, instead of only displaying them,
// possibly changing unexpectedly a previous configuration set by the repo developer.
// This scenario may also result in infinite loop, depending on how the makefile
// and the configuring process are written, thus making the extension unusable.
// Defining a build log to be parsed instead of a dry-run output represents a good alternative.
// Also useful for developing unit tests based on real world code,
// that would not clone a whole repo for testing.
// It is recommended to produce the build log with all the following commands,
// so that the extension has the best content to operate on.
//    --always-make (to make sure no target is skipped because it is up to date)
//    --keep-going (to not stumble on the first error)
//    --print-data-base (special verbose printing which this extension is using for parsing the makefile targets)
// If any of the above switches is missing, the extension may have less log to parse from,
// therefore offering less intellisense information for source files,
// identifying less possible binaries to debug or not providing any makefile targets (other than the 'all' default).
function readBuildLog(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    buildLog = workspaceConfiguration.get<string>("buildLog");

    if (buildLog) {
        logger.message('Found build log path setting "' + buildLog + '"');
        if (!path.isAbsolute(buildLog)) {
            buildLog = path.join(vscode.workspace.rootPath || "", buildLog);
            logger.message('Resolving build log path to  "' + buildLog + '"');
        }

        if (!util.checkFileExistsSync(buildLog)) {
            logger.message("Build log not found. Remove the build log setting or provide a build log file on disk at the given location.");
        }
    }
}

let loggingLevel: string | undefined;
export function getLoggingLevel(): string | undefined { return loggingLevel; }
export function setLoggingLevel(logLevel: string): void { loggingLevel = logLevel; }

// Read from settings the desired logging level for the Makefile Tools extension.
export function readLoggingLevel(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    loggingLevel = workspaceConfiguration.get<string>("loggingLevel");

    if (!loggingLevel) {
        loggingLevel = "Normal";
    }
}

let extensionLog: string | undefined;
export function getExtensionLog(): string | undefined { return extensionLog; }
export function setExtensionLog(path: string): void { extensionLog = path; }

// Read from settings the path to a log file capturing all the "Makefile Tools" output channel content.
// Useful for very large repos, which would produce with a single command a log larger
// than the "Makefile Tools" output channel capacity.
// Also useful for developing unit tests based on real world code,
// that would not clone a whole repo for testing.
// If an extension log is specified, its content is cleared during activation.
// Any messages that are being logged throughout the lifetime of the extension
// are going to be appended to this file.
export function readExtensionLog(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    extensionLog = workspaceConfiguration.get<string>("extensionLog");

    if (extensionLog) {
        logger.message('Found extension log path setting "' + extensionLog + '"');
        if (!path.isAbsolute(extensionLog)) {
            extensionLog = path.join(vscode.workspace.rootPath || "", extensionLog);
            logger.message('Resolving extension log path to "' + extensionLog + '"');
        }
    }
}

// Currently, the makefile extension supports debugging only an executable.
// TODO: support dll debugging.
export interface LaunchConfiguration {
    // todo: add symbol search paths
    binary: string; // full path
    cwd: string;    // execution path
    args: string[]; // arguments
}
export function launchConfigurationToString(configuration: LaunchConfiguration): string {
    let str: string = configuration.cwd;
    str += ">";
    str += util.makeRelPath(configuration.binary, configuration.cwd);
    str += "(";
    str += configuration.args.join(",");
    str += ")";
    return str;
}

export function stringToLaunchConfiguration(str: string): LaunchConfiguration | undefined {
    let regexp: RegExp = /(.*)\>(.*)\((.*)\)/mg;
    let match: RegExpExecArray | null = regexp.exec(str);

    if (match) {
        let fullPath: string = util.makeFullPath(match[2], match[1]);
        let splitArgs: string[] = match[3].split(",");

        return {
            cwd: match[1],
            binary: fullPath,
            args: splitArgs
        };
    } else {
        return undefined;
    }
}

let currentLaunchConfiguration: LaunchConfiguration | undefined;
export function getCurrentLaunchConfiguration(): LaunchConfiguration | undefined { return currentLaunchConfiguration; }
export function setCurrentLaunchConfiguration(configuration: LaunchConfiguration): void {
    currentLaunchConfiguration = configuration;
    statusBar.setLaunchConfiguration(launchConfigurationToString(currentLaunchConfiguration));
}

// Read the current launch configuration from settings storage, update status bar item
function readCurrentLaunchConfiguration(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    currentLaunchConfiguration = workspaceConfiguration.get<LaunchConfiguration>("launchConfiguration");
    if (currentLaunchConfiguration) {
        statusBar.setLaunchConfiguration(launchConfigurationToString(currentLaunchConfiguration));
    } else {
        statusBar.setLaunchConfiguration("No launch configuration set");
    }
}

// Command name and args are used when building from within the VS Code Makefile Tools Extension,
// when parsing all the targets that exist and when updating the cpptools configuration provider
// for IntelliSense.
let configurationMakeCommand: string;
export function getConfigurationMakeCommand(): string { return configurationMakeCommand; }
export function setConfigurationMakeCommand(name: string): void { configurationMakeCommand = name; }

let configurationMakeArgs: string[] = [];
export function getConfigurationMakeArgs(): string[] { return configurationMakeArgs; }
export function setConfigurationMakeArgs(args: string[]): void { configurationMakeArgs = args; }

let configurationBuildLog: string | undefined;
export function getConfigurationBuildLog(): string | undefined { return configurationBuildLog; }
export function setConfigurationBuildLog(name: string): void { configurationBuildLog = name; }

// Read from settings storage, update status bar item
// Current make configuration command = process name + arguments
function readCurrentMakefileConfigurationCommand(): void {
    // Read from disk instead of from the MakefileConfiguration array, to get up to date content
    readMakefileConfigurations();
    getCommandForConfiguration(currentMakefileConfiguration);
    getBuildLogForConfiguration(currentMakefileConfiguration);
}

// Helper to find in the array of MakefileConfiguration which command/args correspond to a configuration name
export function getCommandForConfiguration(configuration: string | undefined): void {
    let makefileConfiguration: MakefileConfiguration | undefined = makefileConfigurations.find(k => {
        if (k.name === configuration) {
            return { ...k, keep: true };
        }
    });

    let makeParsedPathSettings: path.ParsedPath | undefined = makePath ? path.parse(makePath) : undefined;
    let makeParsedPathConfigurations: path.ParsedPath | undefined = makefileConfiguration?.makePath ? path.parse(makefileConfiguration?.makePath) : undefined;

    // Arguments for the make tool can be defined as makeArgs in makefile.configurations setting.
    // When not defined, default to empty array.
    configurationMakeArgs = makefileConfiguration?.makeArgs || [];

    // Name of the make tool can be defined as makePath in makefile.configurations or as makefile.makePath.
    // When none defined, default to "make".
    configurationMakeCommand = makeParsedPathConfigurations?.name || makeParsedPathSettings?.name || "make";

    // Prepend the directory path, if defined in either makefile.configurations or makefile.makePath (first has priority).
    let configurationCommandPath: string = makeParsedPathConfigurations?.dir || makeParsedPathSettings?.dir || "";
    configurationMakeCommand = path.join(configurationCommandPath, configurationMakeCommand);

    // Add the makefile path via the -f make switch.
    // makefile.configurations.makefilePath overwrites makefile.makefilePath.
    let makefileUsed: string | undefined = makefileConfiguration?.makefilePath || makefilePath;
    if (makefileUsed) {
        configurationMakeArgs.push(`-f ${makefileUsed}`);
    }

    if (makefileConfiguration?.makePath) {
        logger.message("Found command '" + configurationMakeCommand + " " + configurationMakeArgs.join(" ") + "' for configuration " + configuration);
    }

    // Some useful warnings about properly defining the makefile and make tool (file name, path and arguments),
    // unless a build log is provided.
    let buildLog: string | undefined = getConfigurationBuildLog();
    let buildLogContent: string | undefined = buildLog ? util.readFile(buildLog) : undefined;
    if (!buildLogContent) {
        if ((!makeParsedPathSettings || makeParsedPathSettings.name === "") &&
            (!makeParsedPathConfigurations || makeParsedPathConfigurations.name === "")) {
            logger.message("Could not find any make tool file name in makefile.configurations.makePath, nor in makefile.makePath. Assuming make.", "verbose");
        }

        if ((!makeParsedPathSettings || makeParsedPathSettings?.dir === "") &&
            (!makeParsedPathConfigurations || makeParsedPathConfigurations?.dir === "")) {
            logger.message("For the extension to work, make must be on the path.");
        }

        if (!makeParsedPathSettings && !makeParsedPathConfigurations) {
            logger.message("It is recommended to define the full path of the make tool in settings (via makefile.makePath OR makefile.configurations.makePath and makefile.makeArgs.");
        }
    }
}

// Helper to find in the array of MakefileConfiguration which buildLog correspond to a configuration name
export function getBuildLogForConfiguration(configuration: string | undefined): void {
    let makefileConfiguration: MakefileConfiguration | undefined = makefileConfigurations.find(k => {
        if (k.name === configuration) {
            return { ...k, keep: true };
        }
    });

    configurationBuildLog = makefileConfiguration?.buildLog;

    if (configurationBuildLog) {
        logger.message('Found build log path setting "' + configurationBuildLog + '" defined for configuration "' + configuration);

        if (!path.isAbsolute(configurationBuildLog)) {
            configurationBuildLog = path.join(vscode.workspace.rootPath || "", configurationBuildLog);
            logger.message('Resolving build log path to "' + configurationBuildLog + '"');
        }

        if (!util.checkFileExistsSync(configurationBuildLog)) {
            logger.message("Build log not found. Remove the build log setting or provide a build log file on disk at the given location.");
        }
    } else {
        // Default to an eventual build log defined in settings
        // If that one is not found on disk, the setting getter already warned about it.
        configurationBuildLog = buildLog;
    }
}

let makefileConfigurations: MakefileConfiguration[] = [];
export function getMakefileConfigurations(): MakefileConfiguration[] { return makefileConfigurations; }
export function setMakefileConfigurations(configurations: MakefileConfiguration[]): void { makefileConfigurations = configurations; }

// Read make configurations optionally defined by the user in settings: makefile.configurations.
function readMakefileConfigurations(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    makefileConfigurations = workspaceConfiguration.get<MakefileConfiguration[]>("configurations") || [];
}

// Last target picked from the set of targets that are run by the makefiles
// when building for the current configuration.
// Saved into the settings storage. Also reflected in the configuration status bar button
let currentTarget: string | undefined;
export function getCurrentTarget(): string | undefined { return currentTarget; }
export function setCurrentTarget(target: string | undefined): void { currentTarget = target; }

// Read current target from settings storage, update status bar item
function readCurrentTarget(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    let buildTarget : string | undefined = workspaceConfiguration.get<string>("buildTarget");
    if (!buildTarget) {
        logger.message("No target defined in the settings file. Assuming 'Default'.", "verbose");
        statusBar.setTarget("Default");
        // If no particular target is defined in settings, use 'Default' for the button
        // but keep the variable empty, to not append it to the make command.
        currentTarget = "";
    } else {
        currentTarget = buildTarget;
        statusBar.setTarget(currentTarget);
    }
}

// There are situations when the extension should ignore the settings changes
// and not trigger re-read and updates.
// Example: cleanup phase of extension tests, which removes settings.
let ignoreSettingsChanged: boolean = false;
export function startListeningToSettingsChanged(): void {
    ignoreSettingsChanged = false;
}
export function stopListeningToSettingsChanged(): void {
    ignoreSettingsChanged = true;
}
// Initialization from settings (or backup default rules), done at activation time
export function initFromSettings(): void {
    readLoggingLevel();
    readExtensionLog();
    readMakePath();
    readMakefilePath();
    readBuildLog();
    readCurrentMakefileConfiguration();
    readCurrentMakefileConfigurationCommand();
    readCurrentTarget();
    readCurrentLaunchConfiguration();

    vscode.workspace.onDidChangeConfiguration(e => {
        if (vscode.workspace.workspaceFolders && !ignoreSettingsChanged &&
            e.affectsConfiguration('makefile', vscode.workspace.workspaceFolders[0].uri)) {
            logger.message("Detected a change in settings");
            // We are interested in updating only some relevant properties.
            // A subset of these should also trigger an IntelliSense config provider update.
            // Avoid unnecessary updates (for example, when settings are modified via the extension quickPick).
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
            let updateConfigProvider: boolean = false; // to trigger IntelliSense config provider refresh

            let updatedBuildConfiguration: string | undefined = workspaceConfiguration.get<string>("buildConfiguration");
            if (updatedBuildConfiguration !== currentMakefileConfiguration &&
                // Undefined build configuration results in "Default",
                // so undefined !== "Default" is not true in this context
                (updatedBuildConfiguration !== undefined || currentMakefileConfiguration !== "Default")) {
                logger.message("Make configuration setting changed.");
                updateConfigProvider = true;
                readCurrentMakefileConfiguration();
            }

            let updatedTarget : string | undefined = workspaceConfiguration.get<string>("buildTarget");
            if (updatedTarget !== currentTarget &&
                // Undefined target results in "",
                // so undefined !== "" is not true in this context
                (updatedTarget !== undefined || currentTarget !== "")) {
                updateConfigProvider = true;
                logger.message("Target setting changed.");
                readCurrentTarget();
            }

            let updatedLaunchConfiguration : string | undefined = workspaceConfiguration.get<string>("launchConfiguration");
            if (updatedLaunchConfiguration !== currentLaunchConfiguration) {
                // Changing a launch configuration does not impact the make or compiler tools invocations,
                // so no IntelliSense update is needed.
                logger.message("Launch configuration setting changed.");
                readCurrentLaunchConfiguration();
            }

            let updatedBuildLog : string | undefined = workspaceConfiguration.get<string>("buildLog");
            if (updatedBuildLog !== buildLog) {
                updateConfigProvider = true;
                logger.message("makefile.buildLog setting changed.");
                readBuildLog();
            }

            let updatedExtensionLog : string | undefined = workspaceConfiguration.get<string>("extensionLog");
            if (updatedExtensionLog !== extensionLog) {
                // No IntelliSense update needed.
                logger.message("makefile.extensionLog setting changed.");
                readExtensionLog();
            }

            let updatedMakePath : string | undefined = workspaceConfiguration.get<string>("makePath");
            if (updatedMakePath !== makePath) {
                // Not very likely, but it is safe to consider that a different make tool
                // may produce a different dry-run output with potential impact on IntelliSense,
                // so trigger an update.
                logger.message("makefile.makePath setting changed.");
                updateConfigProvider = true;
                readMakePath();
            }

            let updatedMakefilePath : string | undefined = workspaceConfiguration.get<string>("makefilePath");
            if (updatedMakefilePath !== makefilePath) {
                logger.message("makefile.makefilePath setting changed.");
                updateConfigProvider = true;
                readMakefilePath();
            }

            let updatedMakefileConfigurations : MakefileConfiguration[] | undefined = workspaceConfiguration.get<MakefileConfiguration[]>("configurations");
            if (updatedMakefileConfigurations !== makefileConfigurations) {
                logger.message("makefile.configurations setting changed.");
                updateConfigProvider = true;
                readCurrentMakefileConfigurationCommand();
            }

            if (updateConfigProvider) {
                // The source for the parsing process can either be a build log or the dry-run output of make tool,
                // but there are some rules of defaults and/or overrides that may be impacted by any of the above settings,
                // so recalculate.
                logger.message("Some of the changes detected in settings are triggering udpates");
                getCommandForConfiguration(currentMakefileConfiguration);
                getBuildLogForConfiguration(currentMakefileConfiguration);
                make.parseBuildOrDryRun();
            }
        }
      });
}

export /*async*/ function setConfigurationByName(configurationName: string): void {//Promise<void> {
    currentMakefileConfiguration = configurationName;
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    workspaceConfiguration.update("buildConfiguration", currentMakefileConfiguration);
    setCurrentMakefileConfiguration(currentMakefileConfiguration);
    make.parseBuildOrDryRun();
}

export function prepareConfigurationsQuickPick(): string[] {
    const items: string[] = makefileConfigurations.map((k => {
        return k.name;
    }));

    if (items.length > 0) {
        logger.message("Found the following configurations defined in makefile.configurations setting: " + items.join(";"));
    } else {
        logger.message("No configurations defined in makefile.configurations setting.");
        items.push("Default");
    }

    return items;
}

// Fill a drop-down with all the configuration names defined by the user in makefile.configurations setting.
// Triggers a cpptools configuration provider update after selection.
export async function setNewConfiguration(): Promise<void> {
    const items: string[] = prepareConfigurationsQuickPick();

    let options : vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus
    const chosen: string | undefined = await vscode.window.showQuickPick(items, options);
    if (chosen) {
        setConfigurationByName(chosen);
    }
}

// Fill a drop-down with all the binaries, with their associated args and executin paths
// as they are parsed from the dry-run output within the scope of
// the current build configuration and the current target.
// Persist the new launch configuration data after the user picks one.
// TODO: deduce also symbol paths.
// TODO: implement UI to collect this information.
// TODO: refactor the dry-run part into make.ts
export function parseLaunchConfigurations(source: string): string[] {
        let binariesLaunchConfigurations: LaunchConfiguration[] = parser.parseForLaunchConfiguration(source);

        let items: string[] = [];
        binariesLaunchConfigurations.forEach(config => {
            items.push(launchConfigurationToString(config));
        });

        items = items.sort().filter(function(elem, index, self) : boolean {
            return index === self.indexOf(elem);
        });

        logger.message("Found the following launch targets defined in the makefile: " + items.join(";"));

        return items;
}

export function parseLaunchConfigurationsFromBuildLog(): string[] | undefined {
    let buildLogContent: string | undefined = configurationBuildLog ? util.readFile(configurationBuildLog) : undefined;
    if (buildLogContent) {
        logger.message('Parsing the provided build log "' + configurationBuildLog + '" for launch configurations...');
        return parseLaunchConfigurations(buildLogContent);
    }

    return undefined;
}

export async function setNewLaunchConfiguration(): Promise<void> {
    let binariesLaunchConfigurationNames: string[] | undefined = parseLaunchConfigurationsFromBuildLog();
    if (binariesLaunchConfigurationNames) {
        selectLaunchConfiguration(binariesLaunchConfigurationNames);
        return;
    }

    let makeArgs: string[] = [];
    // Append --dry-run (to not perform any real build operation),
    // --always-make (to not skip over targets when timestamps indicate nothing needs to be done)
    // and --keep-going (to ensure we get as much info as possible even when some targets fail)
    makeArgs = makeArgs.concat(configurationMakeArgs);
    if (currentTarget) {
        makeArgs.push(currentTarget);
    }
    makeArgs.push("--dry-run");
    makeArgs.push("--always-make");
    makeArgs.push("--keep-going");
    makeArgs.push("--print-data-base");

    let stdoutStr: string = "";
    let stderrStr: string = "";

    logger.message("Generating the dry-run to parse launch configuration for the binaries built by the makefile. Command: " + configurationMakeCommand + " " + makeArgs.join(" "));

    try {
        let stdout : any = (result: string): void => {
            stdoutStr += result;
        };

        let stderr : any = (result: string): void => {
            stderrStr += result;
        };

        let closing : any = (retCode: number, signal: string): void => {
            if (retCode !== 0) {
                logger.message("The verbose make dry-run command for parsing binaries launch configuration failed.");
                logger.message(stderrStr);
            }

            //logger.message("The dry-run output for parsing the binaries launch configuration");
            //logger.message(stdoutStr);
            let launchConfigurationNames: string[] = parseLaunchConfigurations(stdoutStr);
            selectLaunchConfiguration(launchConfigurationNames);
        };

        await util.spawnChildProcess(configurationMakeCommand, makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        logger.message(error);
        return;
    }
}

export function parseTargetsFromBuildLog(): string[] | undefined {
    let buildLogContent: string | undefined = configurationBuildLog ? util.readFile(configurationBuildLog) : undefined;
    if (buildLogContent) {
        logger.message('Parsing the provided build log "' + configurationBuildLog + '" for targets...');
        let makefileTargets: string[] = parser.parseTargets(buildLogContent);
        makefileTargets = makefileTargets.sort();
        return makefileTargets;
    }

    return undefined;
}

// TODO: refactor the dry-run part into make.ts
export async function setNewTarget(): Promise<void> {
    // If a build log is specified in makefile.configurations.buildLog or makefile.buildLog settings,
    // (and if it exists on disk) it must be parsed instead of invoking a dry-run make command.
    let makefileTargets: string[] | undefined = parseTargetsFromBuildLog();
    if (makefileTargets) {
        selectTarget(makefileTargets);
        return;
    }

    let makeArgs: string[] = [];
    // all: must be first argument, to make sure all targets are evaluated and not a subset
    // --dry-run: to ensure no real build is performed for the targets analysis
    // -p: creates a verbose log from which targets are easy to parse
    makeArgs = makeArgs.concat(["all", "--dry-run", "-p"], configurationMakeArgs);
    let stdoutStr: string = "";
    let stderrStr: string = "";

    logger.message("Parsing the targets in the makefile. Command: " + configurationMakeCommand + " " + makeArgs.join(" "));

    let process: child_process.ChildProcess;
    try {
        let stdout : any = (result: string): void => {
            stdoutStr += result;
        };

        let stderr : any = (result: string): void => {
            stderrStr += result;
        };

        let closing : any = (retCode: number, signal: string): void => {
            if (retCode !== 0) {
                logger.message("The verbose make dry-run command for parsing targets failed.");
                logger.message(stderrStr);
            }

            // Don't log stdoutStr in this case, because -p output is too verbose to be useful in any logger area
            makefileTargets = parser.parseTargets(stdoutStr);
            makefileTargets = makefileTargets.sort();
            selectTarget(makefileTargets);
        };

        await util.spawnChildProcess(configurationMakeCommand, makeArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
    } catch (error) {
        logger.message(error);
        return;
    }
}

export /*async*/ function setTargetByName(targetName: string) : void {//Promise<void> {
    currentTarget = targetName;
    statusBar.setTarget(currentTarget);
    logger.message("Setting target " + currentTarget);
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    workspaceConfiguration.update("buildTarget", currentTarget);
    make.parseBuildOrDryRun();
}

// Fill a drop-down with all the target names run by building the makefile for the current configuration
// Triggers a cpptools configuration provider update after selection.
// TODO: change the UI list to multiple selections mode and store an array of current active targets
export async function selectTarget(makefileTargets: string[]): Promise<void> {
    let options : vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus
    const chosen: string | undefined = await vscode.window.showQuickPick(makefileTargets, options);

    if (chosen) {
        setTargetByName(chosen);
    }
}

export /*async*/ function setLaunchConfigurationByName (launchConfigurationName: string) : void {//Promise<void> {
    statusBar.setLaunchConfiguration(launchConfigurationName);
    currentLaunchConfiguration = stringToLaunchConfiguration(launchConfigurationName);
    logger.message('Setting launch target "' + launchConfigurationName + '"');
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    workspaceConfiguration.update("launchConfiguration", currentLaunchConfiguration || undefined);
}

// Fill a drop-down with all the launch configurations found for binaries built by the makefile
// under the scope of the current build configuration and target
// Selection updates current launch configuration that will be ready for the next debug/run operation
export async function selectLaunchConfiguration(launchConfigurationsNames: string[]): Promise<void> {
    // TODO: create a quick pick with description and details for items
    // to better view the long targets commands

    let options: vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus
    if (launchConfigurationsNames.length === 0) {
        options.placeHolder = "No launch targets identified";
    }
    const chosen: string | undefined = await vscode.window.showQuickPick(launchConfigurationsNames, options);

    if (chosen) {
        setLaunchConfigurationByName(chosen);
    }
}

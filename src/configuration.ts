// Configuration support

import * as child_process from 'child_process';
import {extension} from './extension';
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
// Saved into the workspace state. Also reflected in the configuration status bar button.
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

// Read the current configuration from workspace state, update status bar item
function readCurrentMakefileConfiguration(): void {
    let buildConfiguration : string | undefined = extension.extensionContext.workspaceState.get<string>("buildConfiguration");
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
        buildLog = util.resolvePathToRoot(buildLog);
        logger.message('Build log defined at "' + buildLog + '"');
        if (!util.checkFileExistsSync(buildLog)) {
            logger.message("Build log not found on disk.");
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
        extensionLog = util.resolvePathToRoot(extensionLog);
        logger.message('Writing extension log at {0}', extensionLog);
    }
}

let preconfigureScript: string | undefined;
export function getPreconfigureScript(): string | undefined { return preconfigureScript; }
export function setPreconfigureScript(path: string): void { preconfigureScript = path; }

// Read from settings the path to a script file that needs to have been run at least once
// before a sucessful configure of this project.
export function readPreconfigureScript(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    preconfigureScript = workspaceConfiguration.get<string>("preconfigureScript");
    if (preconfigureScript) {
        preconfigureScript = util.resolvePathToRoot(preconfigureScript);
        logger.message('Found pre-configure script defined as {0}', preconfigureScript);
        if (!util.checkFileExistsSync(preconfigureScript)) {
            logger.message("Preconfigure script not found on disk.");
        }
    }
}

let alwaysPreconfigure: boolean;
export function getAlwaysPreconfigure(): boolean { return alwaysPreconfigure; }
export function setAlwaysPreconfigure(path: boolean): void { alwaysPreconfigure = path; }

// Read from settings whether the preconfigure step is supposed to be executed
// always before the configure operation.
export function readAlwaysPreconfigure(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    alwaysPreconfigure = workspaceConfiguration.get<boolean>("alwaysPreconfigure", false);
}

let configurationCache: string;
export function getConfigurationCache(): string { return configurationCache; }
export function setConfigurationCache(path: string): void { configurationCache = path; }

// Read from settings the path to a cache file containing the output of the last dry-run make command.
// This file is recreated when opening a project, when changing the build configuration or the build target
// and when the settings watcher detects a change of any properties that may impact the dryrun output.
export function readConfigurationCache(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configurationCache = util.resolvePathToRoot(workspaceConfiguration.get<string>("ConfigurationCache", "./ConfigurationCache.log"));
    logger.message("Dry-run output cached at {0}", configurationCache);
}

let dryrunSwitches: string[] | undefined;
export function getDryrunSwitches(): string[] | undefined { return dryrunSwitches; }
export function setDryrunSwitches(switches: string[]): void { dryrunSwitches = switches; }

// Read from settings the dry-run switches array. If there is no user definition, the defaults are:
//   --always-make: to not skip over up-to-date targets
//   --keep-going: to not stop at the first error that is encountered
//   --print-data-base: to generate verbose log output that can be parsed to identify all the makefile targets
// Some code bases have various issues with the above make parameters: infrastructure (not build) errors,
// infinite reconfiguration loops, resulting in the extension being unusable.
// To work around this, the setting makefile.dryrunSwitches is providing a way to skip over the problematic make arguments,
// even if this results in not ideal behavior: less information available to be parsed, which leads to incomplete IntelliSense or missing targets.
export function readDryrunSwitches(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    dryrunSwitches = workspaceConfiguration.get<string[]>("dryrunSwitches");
}

// Currently, the makefile extension supports debugging only an executable.
// TODO: Parse for symbol search paths
// TODO: support dll debugging.
export interface LaunchConfiguration {
    // The following properties constitute a minimal launch configuration object.
    // They all can be deduced from the dry-run output or build log.
    // When the user is selecting a launch configuration, the extension is verifying
    // whether there is an entry in the launch configurations array in settings
    // and if not, it is generating a new one with the values computed by the parser.
    binaryPath: string; // full path to the binary that this launch configuration is tied to
    binaryArgs: string[]; // arguments that this binary is called with for this launch configuration
    cwd: string; // folder from where the binary is run

    // The following represent optional properties that can be additionally defined by the user in settings.
    MIMode?: string;
    miDebuggerPath?: string;
    stopAtEntry?: boolean;
    symbolSearchPath?: string;
}

let launchConfigurations: LaunchConfiguration[] = [];
export function getLaunchConfigurations(): LaunchConfiguration[] { return launchConfigurations; }
export function setLaunchConfigurations(configurations: LaunchConfiguration[]): void { launchConfigurations = configurations; }

// Read make configurations optionally defined by the user in settings: makefile.configurations.
function readLaunchConfigurations(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    launchConfigurations = workspaceConfiguration.get<LaunchConfiguration[]>("launchConfigurations") || [];
}

// Helper used to fill the launch configurations quick pick.
// The input object for this method is either read from the settings or it is an object
// constructed by the parser while analyzing the dry-run output (or the build log),
// when the extension is trying to determine if and how (from what folder, with what arguments)
// the makefile is invoking any of the programs that are built by the current target.
// Properties other than cwd, binary path and args could be manually defined by the user
// in settings (after the extension creates a first minimal launch configuration object) and are not relevant
// for the strings being used to populate the quick pick.
// Syntax:
//    [CWD path]>[binaryPath]([binaryArg1,binaryArg2,binaryArg3,...])
export function launchConfigurationToString(configuration: LaunchConfiguration): string {
    let binPath: string = util.makeRelPath(configuration.binaryPath, configuration.cwd);
    let binArgs: string = configuration.binaryArgs.join(",");
    return `${configuration.cwd}>${binPath}(${binArgs})`;
}

// Helper used to construct a minimal launch configuration object
// (only cwd, binary path and arguments) from a string that respects
// the syntax of its quick pick.
export function stringToLaunchConfiguration(str: string): LaunchConfiguration | undefined {
    let regexp: RegExp = /(.*)\>(.*)\((.*)\)/mg;
    let match: RegExpExecArray | null = regexp.exec(str);

    if (match) {
        let fullPath: string = util.makeFullPath(match[2], match[1]);
        let splitArgs: string[] = match[3].split(",");

        return {
            cwd: match[1],
            binaryPath: fullPath,
            binaryArgs: splitArgs
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

function getLaunchConfiguration(name: string): LaunchConfiguration | undefined {
    return launchConfigurations.find(k => {
        if (launchConfigurationToString(k) === name) {
            return { ...k, keep: true };
        }
    });
}

// Construct the current launch configuration object:
// Read the identifier from workspace state storage, then find the corresponding object
// in the launch configurations array from settings.
// Also update the status bar item.
function readCurrentLaunchConfiguration(): void {
    readLaunchConfigurations();
    let currentLaunchConfigurationName: string | undefined = extension.extensionContext.workspaceState.get<string>("launchConfiguration");
    if (currentLaunchConfigurationName) {
        currentLaunchConfiguration = getLaunchConfiguration(currentLaunchConfigurationName);
    }

    if (currentLaunchConfiguration) {
        statusBar.setLaunchConfiguration(launchConfigurationToString(currentLaunchConfiguration));
    } else {
        statusBar.setLaunchConfiguration("No launch configuration set");
    }
}

export interface DefaultLaunchConfiguration {
    MIMode?: string;
    miDebuggerPath?: string;
    stopAtEntry?: boolean;
    symbolSearchPath?: string;
}

let defaultLaunchConfiguration: DefaultLaunchConfiguration | undefined;
export function getDefaultLaunchConfiguration(): DefaultLaunchConfiguration | undefined { return defaultLaunchConfiguration; }
// No setter needed. Currently only the user can define makefile.defaultLaunchConfiguration

export function readDefaultLaunchConfiguration(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    defaultLaunchConfiguration = workspaceConfiguration.get<DefaultLaunchConfiguration>("defaultLaunchConfiguration");
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
    readMakefileConfigurations();
    getCommandForConfiguration(currentMakefileConfiguration);
    getBuildLogForConfiguration(currentMakefileConfiguration);
}

// Helper to find in the array of MakefileConfiguration which command/args correspond to a configuration name.
// Higher level settings (like makefile.makePath or makefilePath) also have an additional effect on the final command.
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
    // Make sure to copy from makefile.configurations.makeArgs because we are going to append more switches,
    // which shouldn't be identified as read from settings.
    // Make sure we start from a fresh empty configurationMakeArgs because there may be old arguments that don't apply anymore.
    configurationMakeArgs = makefileConfiguration?.makeArgs?.concat() || [];

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
        configurationMakeArgs.push("-f");
        configurationMakeArgs.push(makefileUsed);
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
    let detectedUnnamedConfigurations: boolean = false;
    let unnamedConfigurationId: number = 0;

    // Collect unnamed configurations (probably) defined by the extension earlier,
    // to make sure we avoid duplicates in case any new configuration is in need of a name.
    let unnamedConfigurationNames: string [] = makefileConfigurations.map((k => {
        return k.name;
    }));
    unnamedConfigurationNames = unnamedConfigurationNames.filter(item => (item && item.startsWith("Unnamed configuration")));

    makefileConfigurations.forEach(element => {
        if (!element.name) {
            detectedUnnamedConfigurations = true;

            // Just considering the possibility that there are already unnamed configurations
            // defined with IDs other than the rule we assume (like not consecutive numbers, but not only).
            // This may happen when the user deletes configurations at some point without updating the IDs.
            unnamedConfigurationId++;
            let autoGeneratedName: string = `Unnamed configuration ${unnamedConfigurationId}`;
            while (unnamedConfigurationNames.includes(autoGeneratedName)) {
                unnamedConfigurationId++;
                autoGeneratedName = `Unnamed configuration ${unnamedConfigurationId}`;
            }

            element.name = autoGeneratedName;
            logger.message(`Defining name ${autoGeneratedName} for unnamed configuration ${element}.`);
        }
    });

    if (detectedUnnamedConfigurations) {
        logger.message("Updating makefile configurations in settings.");
        workspaceConfiguration.update("configurations", makefileConfigurations);
    }
}

// Last target picked from the set of targets that are run by the makefiles
// when building for the current configuration.
// Saved into the settings storage. Also reflected in the configuration status bar button
let currentTarget: string | undefined;
export function getCurrentTarget(): string | undefined { return currentTarget; }
export function setCurrentTarget(target: string | undefined): void { currentTarget = target; }

// Read current target from workspace state, update status bar item
function readCurrentTarget(): void {
    let buildTarget : string | undefined = extension.extensionContext.workspaceState.get<string>("buildTarget");
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

let configureOnOpen: boolean;
export function getConfigureOnOpen(): boolean { return configureOnOpen; }
export function setConfigureOnOpen(configure: boolean): void { configureOnOpen = configure; }
export function readConfigureOnOpen(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configureOnOpen = workspaceConfiguration.get<boolean>("configureOnOpen", true);
}

let configureOnEdit: boolean;
export function getConfigureOnEdit(): boolean { return configureOnEdit; }
export function setConfigureOnEdit(configure: boolean): void { configureOnEdit = configure; }
export function readConfigureOnEdit(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configureOnEdit = workspaceConfiguration.get<boolean>("configureOnEdit", true);
}

let configureAfterCommand: boolean;
export function getConfigureAfterCommand(): boolean { return configureAfterCommand; }
export function setConfigureAfterCommand(configure: boolean): void { configureAfterCommand = configure; }
export function readConfigureAfterCommand(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configureAfterCommand = workspaceConfiguration.get<boolean>("configureAfterCommand", true);
}

 // Triggers IntelliSense config provider updates after relevant changes
 // are made in settings or in the makefiles.
 // To avoid unnecessary dry-runs, these updates are not performed with every document save
 // but after leaving the focus of the document.
let configProviderUpdatePending: boolean = false;
export function getConfigProviderUpdatePending(): boolean { return configureAfterCommand; }
export function setConfigProviderUpdatePending(configure: boolean): void { configureAfterCommand = configure; }

// Initialization from settings (or backup default rules), done at activation time
export function initFromStateAndSettings(): void {
    readLoggingLevel();
    readConfigurationCache();
    readMakePath();
    readMakefilePath();
    readBuildLog();
    readPreconfigureScript();
    readAlwaysPreconfigure();
    readDryrunSwitches();
    readCurrentMakefileConfiguration();
    readCurrentMakefileConfigurationCommand();
    readCurrentTarget();
    readCurrentLaunchConfiguration();
    readDefaultLaunchConfiguration();
    readConfigureOnOpen();
    readConfigureOnEdit();
    readConfigureAfterCommand();

    // Verify the dirty state of the IntelliSense config provider and update accordingly.
    // The makefile.configureOnEdit setting can be set to false when this behavior is inconvenient.
    vscode.window.onDidChangeActiveTextEditor(e => {
        if (configProviderUpdatePending) {
            if (configureOnEdit) {
                // Normal configure doesn't have effect when the settings relevant for configProviderUpdatePending changed.
                logger.message("Configuring clean after settings changes...");
                make.cleanConfigure(); // this sets configProviderUpdatePending back to false
            }
        }
    });

    // Modifying any makefile should trigger an IntelliSense config provider update,
    // so make the dirty state true.
    // TODO: limit to makefiles relevant to this project, instead of any random makefile anywhere.
    //       We can't listen only to the makefile pointed to by makefile.makefilePath,
    //       because that is only the entry point and can refer to other relevant makefiles.
    // TODO: don't trigger an update for any dummy save, verify how the content changed.
    vscode.workspace.onDidSaveTextDocument(e => {
        if (e.uri.fsPath.toLowerCase().endsWith("makefile")) {
            configProviderUpdatePending = true;
        }
    });

    // Watch for Makefile Tools setting updates that can change the IntelliSense config provider dirty state
    vscode.workspace.onDidChangeConfiguration(e => {
        if (vscode.workspace.workspaceFolders && !ignoreSettingsChanged &&
            e.affectsConfiguration('makefile', vscode.workspace.workspaceFolders[0].uri)) {
            // We are interested in updating only some relevant properties.
            // A subset of these should also trigger an IntelliSense config provider update.
            // Avoid unnecessary updates (for example, when settings are modified via the extension quickPick).
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");

            let updatedLaunchConfigurations : LaunchConfiguration[] | undefined = workspaceConfiguration.get<LaunchConfiguration[]>("launchConfigurations");
            if (!util.areEqual(updatedLaunchConfigurations, launchConfigurations)) {
                // Changing a launch configuration does not impact the make or compiler tools invocations,
                // so no IntelliSense update is needed.
                logger.message("Launch configurations setting changed.");
                readCurrentLaunchConfiguration();
            }

            let updatedDefaultLaunchConfiguration : DefaultLaunchConfiguration | undefined = workspaceConfiguration.get<DefaultLaunchConfiguration>("defaultLaunchConfiguration");
            if (!util.areEqual(updatedDefaultLaunchConfiguration, defaultLaunchConfiguration)) {
                // Changing a global debug configuration does not impact the make or compiler tools invocations,
                // so no IntelliSense update is needed.
                logger.message("makefile.defaultLaunchConfiguration setting changed.");
                readDefaultLaunchConfiguration();
            }

            let updatedBuildLog : string | undefined = workspaceConfiguration.get<string>("buildLog");
            if (updatedBuildLog) {
                updatedBuildLog = util.resolvePathToRoot(updatedBuildLog);
            }
            if (updatedBuildLog !== buildLog) {
                configProviderUpdatePending = true;
                logger.message("makefile.buildLog setting changed.");
                readBuildLog();
            }

            let updatedExtensionLog : string | undefined = workspaceConfiguration.get<string>("extensionLog");
            if (updatedExtensionLog) {
                updatedExtensionLog = util.resolvePathToRoot(updatedExtensionLog);
            }
            if (updatedExtensionLog !== extensionLog) {
                // No IntelliSense update needed.
                logger.message("makefile.extensionLog setting changed.");
                readExtensionLog();
            }

            let updatedPreconfigureScript : string | undefined = workspaceConfiguration.get<string>("preconfigureScript");
            if (updatedPreconfigureScript) {
                updatedPreconfigureScript = util.resolvePathToRoot(updatedPreconfigureScript);
            }
            if (updatedPreconfigureScript !== preconfigureScript) {
                // No IntelliSense update needed.
                logger.message("makefile.preconfigureScript setting changed.");
                readPreconfigureScript();
            }

            let updatedAlwaysPreconfigure : boolean = workspaceConfiguration.get<boolean>("alwaysPreconfigure", false);
            if (updatedAlwaysPreconfigure !== alwaysPreconfigure) {
                // No IntelliSense update needed.
                logger.message("makefile.alwaysPreconfigure setting changed.");
                readAlwaysPreconfigure();
            }

            let updatedConfigurationCache : string | undefined = workspaceConfiguration.get<string>("configurationCache", "./ConfigurationCache.log");
            if (util.resolvePathToRoot(updatedConfigurationCache) !== configurationCache) {
                // A change in makefile.configurationCache should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                configProviderUpdatePending = !buildLog || !util.checkFileExistsSync(buildLog);
                logger.message("makefile.ConfigurationCache setting changed.");
                readConfigurationCache();
            }

            let updatedMakePath : string | undefined = workspaceConfiguration.get<string>("makePath");
            if (updatedMakePath !== makePath) {
                // Not very likely, but it is safe to consider that a different make tool
                // may produce a different dry-run output with potential impact on IntelliSense,
                // so trigger an update.
                logger.message("makefile.makePath setting changed.");

                // A change in makefile.makePath should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                configProviderUpdatePending = !buildLog || !util.checkFileExistsSync(buildLog);
                readMakePath();
            }

            let updatedMakefilePath : string | undefined = workspaceConfiguration.get<string>("makefilePath");
            if (updatedMakefilePath !== makefilePath) {
                // A change in makefile.makefilePath should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                configProviderUpdatePending = !buildLog || !util.checkFileExistsSync(buildLog);
                logger.message("makefile.makefilePath setting changed.");
                readMakefilePath();
            }

            let updatedMakefileConfigurations : MakefileConfiguration[] | undefined = workspaceConfiguration.get<MakefileConfiguration[]>("configurations");
            if (!util.areEqual(updatedMakefileConfigurations, makefileConfigurations)) {
                // todo: skip over updating the IntelliSense configuration provider if the current makefile configuration
                // is not among the subobjects that suffered modifications.
                logger.message("makefile.configurations setting changed.");
                configProviderUpdatePending = true;
                readMakefileConfigurations();
            }

            let updatedDryrunSwitches : string[] | undefined = workspaceConfiguration.get<string[]>("dryrunSwitches");
            if (!util.areEqual(updatedDryrunSwitches, dryrunSwitches)) {
                // A change in makefile.dryrunSwitches should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                configProviderUpdatePending = !buildLog || !util.checkFileExistsSync(buildLog);
                logger.message("makefile.dryrunSwitches setting changed.");
                readDryrunSwitches();
            }

            let updatedConfigureOnOpen : boolean | undefined = workspaceConfiguration.get<boolean>("configureOnOpen");
            if (updatedConfigureOnOpen !== configureOnOpen) {
                logger.message("makefile.configureOnOpen setting changed.");
                readConfigureOnOpen();
            }

            let updatedConfigureOnEdit : boolean | undefined = workspaceConfiguration.get<boolean>("configureOnEdit");
            if (updatedConfigureOnEdit !== configureOnEdit) {
                logger.message("makefile.configureOnEdit setting changed.");
                readConfigureOnEdit();
            }

            let updatedConfigureAfterCommand : boolean | undefined = workspaceConfiguration.get<boolean>("configureAfterCommand");
            if (updatedConfigureAfterCommand !== configureAfterCommand) {
                logger.message("makefile.configureAfterCommand setting changed.");
                readConfigureAfterCommand();
            }

            // Final updates in some constructs that depend on more than one of the above settings.
            if (configProviderUpdatePending) {
                getCommandForConfiguration(currentMakefileConfiguration);
                getBuildLogForConfiguration(currentMakefileConfiguration);
            }
        }
      });
}

export function setConfigurationByName(configurationName: string): void {
    extension.extensionContext.workspaceState.update("buildConfiguration", configurationName);
    setCurrentMakefileConfiguration(configurationName);
    if (configureAfterCommand) {
        make.cleanConfigure();
    }
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

export function setTargetByName(targetName: string) : void {
    currentTarget = targetName;
    statusBar.setTarget(currentTarget);
    logger.message("Setting target " + currentTarget);
    extension.extensionContext.workspaceState.update("buildTarget", currentTarget);
    if (configureAfterCommand) {
        // The set of build targets remains the same even if the current target has changed
        make.cleanConfigure(false);
    }
}

// Fill a drop-down with all the target names run by building the makefile for the current configuration
// Triggers a cpptools configuration provider update after selection.
// TODO: change the UI list to multiple selections mode and store an array of current active targets
export async function selectTarget(): Promise<void> {
    let options : vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus

    // Ensure "all" is always available as a target to select.
    // There are scenarios when "all" might not be present in the list of available targets,
    // for example when the extension is using a build log or dryrun cache of a previous state
    // when a particular target was selected and a dryrun applied on that is producing a subset of targets,
    // making it impossible to select "all" back again without resetting the Makefile Tools state
    // or switching to a different makefile configuration or implementing an editable target quick pick.
    // Another situation where "all" would inconveniently miss from the quick pick is when the user is
    // providing a build log without the required verbosity for parsing targets (-p or --print-data-base switches).
    // When the extension is not reading from build log or dryrun cache, we have logic to prevent
    // "all" from getting lost: make sure the target is not appended to the make invocation
    // whose output is used to parse the targets (as opposed to parsing for IntelliSense or launch targets
    // when the current target must be appended to the make command).
    if (!buildTargets.includes("all")) {
        buildTargets.push("all");
    }

    const chosen: string | undefined = await vscode.window.showQuickPick(buildTargets, options);

    if (chosen) {
        setTargetByName(chosen);
    }
}

// The 'name' of a launch configuration is a string following this syntax:
//    [cwd]>[binaryPath](binaryArg1,binaryArg2,...)
// These strings are found by the extension while parsing the output of the dry-run or build log,
// which reflect possible different ways of running the binaries built by the makefile.
// TODO: If we find that these strings are not unique (meaning the makefile may invoke
// the given binary in the exact same way more than once), incorporate also the containing target
// name in the syntax (or, since in theory one can write a makefile target to run the same binary
// in the same way more than once, add some number suffix).
export function setLaunchConfigurationByName (launchConfigurationName: string) : void {
    // Find the matching entry in the array of launch configurations
    // or generate a new entry in settings if none are found.
    currentLaunchConfiguration = getLaunchConfiguration(launchConfigurationName);
    if (!currentLaunchConfiguration) {
        currentLaunchConfiguration = stringToLaunchConfiguration(launchConfigurationName);
        if (currentLaunchConfiguration) {
            launchConfigurations.push(currentLaunchConfiguration);
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
            workspaceConfiguration.update("launchConfigurations", launchConfigurations);
            logger.message("Inserting a new entry for {0} in the array of makefile.launchConfigurations. " +
                           "You may define any additional debug properties for it in settings.", launchConfigurationName);
        }
    }

    if (currentLaunchConfiguration) {
        logger.message('Setting current launch target "' + launchConfigurationName + '"');
        extension.extensionContext.workspaceState.update("launchConfiguration", launchConfigurationName);
        statusBar.setLaunchConfiguration(launchConfigurationName);
    } else {
        logger.message(`A problem occured while analyzing launch configuration name ${launchConfigurationName}. Current launch configuration is unset.`);
        extension.extensionContext.workspaceState.update("launchConfiguration", undefined);
        statusBar.setLaunchConfiguration("No launch configuration set");
    }
}

// Fill a drop-down with all the launch configurations found for binaries built by the makefile
// under the scope of the current build configuration and target
// Selection updates current launch configuration that will be ready for the next debug/run operation
export async function selectLaunchConfiguration(): Promise<void> {
    // TODO: create a quick pick with description and details for items
    // to better view the long targets commands

    let options: vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus
    if (launchTargets.length === 0) {
        options.placeHolder = "No launch targets identified";
    }
    const chosen: string | undefined = await vscode.window.showQuickPick(launchTargets, options);

    if (chosen) {
        setLaunchConfigurationByName(chosen);
    }
}

let buildTargets: string[] = [];
export function getBuildTargets(): string[] { return buildTargets; }
export function setBuildTargets(targets: string[]): void { buildTargets = targets; }

let launchTargets: string[] = [];
export function getLaunchTargets(): string[] { return launchTargets; }
export function setLaunchTargets(targets: string[]): void { launchTargets = targets; }

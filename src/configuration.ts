// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Configuration support

import {extension} from './extension';
import * as logger from './logger';
import * as make from './make';
import * as ui from './ui';
import * as util from './util';
import * as vscode from 'vscode';
import * as path from 'path';
import * as telemetry from './telemetry';

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
    analyzeConfigureParams();
}

// Read the current configuration from workspace state, update status bar item
function readCurrentMakefileConfiguration(): void {
    let buildConfiguration : string | undefined = extension.getState().buildConfiguration;
    if (!buildConfiguration) {
        logger.message("No current configuration is defined in the workspace state. Assuming 'Default'.");
        currentMakefileConfiguration = "Default";
    } else {
        logger.message(`Reading current configuration "${buildConfiguration}" from the workspace state.`);
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
    // Don't resolve makePath to root, because make needs to be searched in the path too.
    if (!makePath) {
        logger.message("No path to the make tool is defined in the settings file");
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
        logger.message("No path to the makefile is defined in the settings file");
    } else {
        makefilePath = util.resolvePathToRoot(makefilePath);
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

    logger.message(`Logging level: ${loggingLevel}`);
}

let extensionOutputFolder: string | undefined;
export function getExtensionOutputFolder(): string | undefined { return extensionOutputFolder; }
export function setExtensionOutputFolder(folder: string): void { extensionOutputFolder = folder; }

// Read from settings the path to a folder where the extension is dropping various output files
// (like extension.log, dry-run.log, targets.log).
// Useful to control where such potentially large files should reside.
export function readExtensionOutputFolder(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    const propKey: string = "extensionOutputFolder";
    extensionOutputFolder = workspaceConfiguration.get<string>(propKey);
    if (extensionOutputFolder) {
        extensionOutputFolder = util.resolvePathToRoot(extensionOutputFolder);

        if (!util.checkDirectoryExistsSync(extensionOutputFolder)) {
            logger.message(`Provided extension output folder does not exist: ${extensionOutputFolder}.`);
            let defaultExtensionOutputFolder: string | undefined = workspaceConfiguration.inspect<string>(propKey)?.defaultValue;
            if (defaultExtensionOutputFolder) {
                logger.message(`Switching to default: ${defaultExtensionOutputFolder}.`);
                workspaceConfiguration.update(propKey, defaultExtensionOutputFolder);
                extensionOutputFolder = util.resolvePathToRoot(defaultExtensionOutputFolder);
            }
        }

        logger.message(`Dropping various extension output files at ${extensionOutputFolder}`);
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
        // If there is a directory defined within the extension log path,
        // honor it and don't append to extensionOutputFolder.
        let parsePath: path.ParsedPath = path.parse(extensionLog);
        if (extensionOutputFolder && !parsePath.dir) {
            extensionLog = path.join(extensionOutputFolder, extensionLog);
        } else {
            extensionLog = util.resolvePathToRoot(extensionLog);
        }

        logger.message(`Writing extension log at ${extensionLog}`);
    }
}

let preConfigureScript: string | undefined;
export function getPreConfigureScript(): string | undefined { return preConfigureScript; }
export function setPreConfigureScript(path: string): void { preConfigureScript = path; }

// Read from settings the path to a script file that needs to have been run at least once
// before a sucessful configure of this project.
export function readPreConfigureScript(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    preConfigureScript = workspaceConfiguration.get<string>("preConfigureScript");
    if (preConfigureScript) {
        preConfigureScript = util.resolvePathToRoot(preConfigureScript);
        logger.message(`Found pre-configure script defined as ${preConfigureScript}`);
        if (!util.checkFileExistsSync(preConfigureScript)) {
            logger.message("Pre-configure script not found on disk.");
        }
    }
}

let alwaysPreConfigure: boolean | undefined;
export function getAlwaysPreConfigure(): boolean | undefined { return alwaysPreConfigure; }
export function setAlwaysPreConfigure(path: boolean): void { alwaysPreConfigure = path; }

// Read from settings whether the pre-configure step is supposed to be executed
// always before the configure operation.
export function readAlwaysPreConfigure(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    alwaysPreConfigure = workspaceConfiguration.get<boolean>("alwaysPreConfigure");
    logger.message(`Always pre-configure: ${alwaysPreConfigure}`);
}

let configurationCachePath: string | undefined;
export function getConfigurationCachePath(): string | undefined { return configurationCachePath; }
export function setConfigurationCachePath(path: string): void { configurationCachePath = path; }

// Read from settings the path to a cache file containing the output of the last dry-run make command.
// This file is recreated when opening a project, when changing the build configuration or the build target
// and when the settings watcher detects a change of any properties that may impact the dryrun output.
export function readConfigurationCachePath(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configurationCachePath = workspaceConfiguration.get<string>("configurationCachePath");
    if (configurationCachePath) {
        // If there is a directory defined within the configuration cache path,
        // honor it and don't append to extensionOutputFolder.
        let parsePath: path.ParsedPath = path.parse(configurationCachePath);
        if (extensionOutputFolder && !parsePath.dir) {
            configurationCachePath = path.join(extensionOutputFolder, configurationCachePath);
        } else {
            configurationCachePath = util.resolvePathToRoot(configurationCachePath);
        }
    }

    logger.message(`Configurations cached at ${configurationCachePath}`);
}

let compileCommandsPath: string | undefined;
export function getCompileCommandsPath(): string | undefined { return compileCommandsPath; }
export function setCompileCommandsPath(path: string): void { compileCommandsPath = path; }
export function readCompileCommandsPath(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");

    compileCommandsPath = workspaceConfiguration.get<string>("compileCommandsPath");
    if (compileCommandsPath) {
        compileCommandsPath = util.resolvePathToRoot(compileCommandsPath);
    }

    logger.message(`compile_commands.json path: ${compileCommandsPath}`);
}

let additionalCompilerNames: string[] | undefined;
export function getAdditionalCompilerNames(): string[] | undefined { return additionalCompilerNames; }
export function setAdditionalCompilerNames(compilerNames: string[]): void { additionalCompilerNames = compilerNames; }
export function readAdditionalCompilerNames(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    additionalCompilerNames = workspaceConfiguration.get<string[]>("additionalCompilerNames");
    logger.message(`Additional compiler names: ${additionalCompilerNames}`);
}

let excludeCompilerNames: string[] | undefined;
export function getExcludeCompilerNames(): string[] | undefined { return excludeCompilerNames; }
export function setExcludeCompilerNames(compilerNames: string[]): void { excludeCompilerNames = compilerNames; }
export function readExcludeCompilerNames(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    excludeCompilerNames = workspaceConfiguration.get<string[]>("excludeCompilerNames");
    logger.message(`Exclude compiler names: ${excludeCompilerNames}`);
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
    logger.message(`Dry-run switches: ${dryrunSwitches}`);
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
export async function stringToLaunchConfiguration(str: string): Promise<LaunchConfiguration | undefined> {
    let regexp: RegExp = /(.*)\>(.*)\((.*)\)/mg;
    let match: RegExpExecArray | null = regexp.exec(str);

    if (match) {
        let fullPath: string = await util.makeFullPath(match[2], match[1]);
        let splitArgs: string[] = (match[3] === "") ? [] : match[3].split(",");

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
    let currentLaunchConfigurationName: string | undefined = extension.getState().launchConfiguration;
    if (currentLaunchConfigurationName) {
        currentLaunchConfiguration = getLaunchConfiguration(currentLaunchConfigurationName);
    }

    if (currentLaunchConfiguration) {
        let launchConfigStr: string = launchConfigurationToString(currentLaunchConfiguration);
        logger.message(`Reading current launch configuration "${launchConfigStr}" from the workspace state.`);
        statusBar.setLaunchConfiguration(launchConfigStr);
    } else {
        logger.message("No current launch configuration is set in the workspace state.");
        statusBar.setLaunchConfiguration("No launch configuration set.");
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
    logger.message(`Default launch configuration: MIMode = ${defaultLaunchConfiguration?.MIMode},
                    miDebuggerPath = ${defaultLaunchConfiguration?.miDebuggerPath},
                    stopAtEntry = ${defaultLaunchConfiguration?.stopAtEntry},
                    symbolSearchPath = ${defaultLaunchConfiguration?.symbolSearchPath}`);
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

// Analyze the settings of the current makefile configuration and the global workspace settings,
// according to various merging rules and decide what make command and build log
// apply to the current makefile configuration.
function analyzeConfigureParams(): void {
    getBuildLogForConfiguration(currentMakefileConfiguration);
    getCommandForConfiguration(currentMakefileConfiguration);
}

// Helper to find in the array of MakefileConfiguration which command/args correspond to a configuration name.
// Higher level settings (like makefile.makePath or makefilePath) also have an additional effect on the final command.
export function getCommandForConfiguration(configuration: string | undefined): void {
    let makefileConfiguration: MakefileConfiguration | undefined = makefileConfigurations.find(k => {
        if (k.name === configuration) {
            return k;
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
    // Add the ".exe" extension on windows, otherwise the file search APIs don't find it.
    if (process.platform === "win32") {
        configurationMakeCommand += ".exe";
    }

    // Add the makefile path via the -f make switch.
    // makefile.configurations.makefilePath overwrites makefile.makefilePath.
    let makefileUsed: string | undefined = makefileConfiguration?.makefilePath || makefilePath;
    if (makefileUsed) {
        configurationMakeArgs.push("-f");
        configurationMakeArgs.push(makefileUsed);
        // Need to rethink this (GitHub 59).
        // Some repos don't work when we automatically add -C, others don't work when we don't.
        // configurationMakeArgs.push("-C");
        // configurationMakeArgs.push(path.parse(makefileUsed).dir);
    }

    if (configurationMakeCommand) {
        logger.message("Deduced command '" + configurationMakeCommand + " " + configurationMakeArgs.join(" ") + "' for configuration " + configuration);
    }

    // Validation and warnings about properly defining the makefile and make tool.
    // These are not needed if the current configuration reads from a build log instead of dry-run output.
    let buildLog: string | undefined = getConfigurationBuildLog();
    let buildLogContent: string | undefined = buildLog ? util.readFile(buildLog) : undefined;
    if (!buildLogContent) {
        if ((!makeParsedPathSettings || makeParsedPathSettings.name === "") &&
            (!makeParsedPathConfigurations || makeParsedPathConfigurations.name === "")) {
            logger.message("Could not find any make tool file name in makefile.configurations.makePath, nor in makefile.makePath. Assuming make.");
        }

        // If configuration command has a path (absolute or relative), check if it exists on disk and error if not.
        // If no path is given to the make tool, search all paths in the environment and error if make is not on the path.
        if (configurationCommandPath  !== "") {
            if (!util.checkFileExistsSync(configurationMakeCommand)) {
                vscode.window.showErrorMessage("Make not found.");
                logger.message("Make was not found on disk at the location provided via makefile.makePath or makefile.configurations[].makePath.");

                // How often location settings don't work (maybe because not yet expanding variables)?
                const telemetryProperties: telemetry.Properties = {
                    reason: "not found at path given in settings"
                };
                telemetry.logEvent("makeNotFound", telemetryProperties);
            }
        } else {
            if (!util.toolPathInEnv(path.parse(configurationMakeCommand).base)) {
                vscode.window.showErrorMessage("Make not found.");
                logger.message("Make was not given any path in settings and is also not found on the environment path.");

                // Do the users need an environment automatically set by the extension?
                // With a kits feature or expanding on the pre-configure script.
                const telemetryProperties: telemetry.Properties = {
                    reason: "not found in environment path"
                };
                telemetry.logEvent("makeNotFound", telemetryProperties);
            }
        }

        // Check for makefile path on disk. The default is 'makefile' in the root of the workspace.
        // On linux/mac, it often is 'Makefile', so we have to verify we default to the right filename.
        if (!makefileUsed) {
            makefileUsed = (util.checkFileExistsSync(util.resolvePathToRoot("./Makefile"))) ? "./Makefile" : "./makefile";
        }

        makefileUsed = util.resolvePathToRoot(makefileUsed);
        if (!util.checkFileExistsSync(makefileUsed)) {
            vscode.window.showErrorMessage("Makefile entry point not found.");
            logger.message("The makefile entry point was not found. " +
                           "Make sure it exists at the location defined by makefile.makefilePath or makefile.configurations[].makefilePath " +
                           "or in the root of the workspace.");

            const telemetryProperties: telemetry.Properties = {
                reason: makefileUsed ?
                        "not found at path given in settings" : // we may need more advanced ability to process settings
                        "not found in workspace root" // insight into different project structures
            };
            telemetry.logEvent("makefileNotFound", telemetryProperties);
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
        // If that one is not found on disk, the setting reader already warned about it.
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

    // Log the updated list of configuration names
    const makefileConfigurationNames: string[] = makefileConfigurations.map((k => {
        return k.name;
    }));

    if (makefileConfigurationNames.length > 0) {
        logger.message("Found the following configurations defined in makefile.configurations setting: " +
            makefileConfigurationNames.join(";"));
    }

    // Verify if the current makefile configuration is still part of the list and unset otherwise.
    // Exception: "Default" which means the user didn't set it and relies on whatever default
    // the current set of makefiles support. "Default" is not going to be part of the list
    // but we shouldn't log about it.
    if (currentMakefileConfiguration !== "Default" && !makefileConfigurationNames.includes(currentMakefileConfiguration)) {
        logger.message(`Current makefile configuration ${currentMakefileConfiguration} is no longer present in the available list.` +
            ` Re-setting the current makefile configuration to default.`);
        setConfigurationByName("Default");
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
    let buildTarget : string | undefined = extension.getState().buildTarget;
    if (!buildTarget) {
        logger.message("No target defined in the workspace state. Assuming 'Default'.");
        statusBar.setTarget("Default");
        // If no particular target is defined in settings, use 'Default' for the button
        // but keep the variable empty, to not append it to the make command.
        currentTarget = "";
    } else {
        currentTarget = buildTarget;
        logger.message(`Reading current build target "${currentTarget}" from the workspace state.`);
        statusBar.setTarget(currentTarget);
    }
}

let configureOnOpen: boolean | undefined;
export function getConfigureOnOpen(): boolean | undefined { return configureOnOpen; }
export function setConfigureOnOpen(configure: boolean): void { configureOnOpen = configure; }
export function readConfigureOnOpen(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configureOnOpen = workspaceConfiguration.get<boolean>("configureOnOpen");
    logger.message(`Configure on open: ${configureOnOpen}`);
}

let configureOnEdit: boolean | undefined;
export function getConfigureOnEdit(): boolean | undefined { return configureOnEdit; }
export function setConfigureOnEdit(configure: boolean): void { configureOnEdit = configure; }
export function readConfigureOnEdit(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configureOnEdit = workspaceConfiguration.get<boolean>("configureOnEdit");
    logger.message(`Configure on edit: ${configureOnEdit}`);
}

let configureAfterCommand: boolean | undefined;
export function getConfigureAfterCommand(): boolean | undefined { return configureAfterCommand; }
export function setConfigureAfterCommand(configure: boolean): void { configureAfterCommand = configure; }
export function readConfigureAfterCommand(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    configureAfterCommand = workspaceConfiguration.get<boolean>("configureAfterCommand");
    logger.message(`Configure after command: ${configureAfterCommand}`);
}

let phonyOnlyTargets: boolean | undefined;
export function getPhonyOnlyTargets(): boolean | undefined { return phonyOnlyTargets; }
export function setPhonyOnlyTargets(phony: boolean): void { phonyOnlyTargets = phony; }
export function readPhonyOnlyTargets(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    phonyOnlyTargets = workspaceConfiguration.get<boolean>("phonyOnlyTargets");
    logger.message(`Only .PHONY targets: ${phonyOnlyTargets}`);
}

let saveBeforeBuildOrConfigure: boolean | undefined;
export function getSaveBeforeBuildOrConfigure(): boolean | undefined { return saveBeforeBuildOrConfigure; }
export function setSaveBeforeBuildOrConfigure(save: boolean): void { saveBeforeBuildOrConfigure = save; }
export function readSaveBeforeBuildOrConfigure(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    saveBeforeBuildOrConfigure = workspaceConfiguration.get<boolean>("saveBeforeBuildOrConfigure");
    logger.message(`Save before build or configure: ${saveBeforeBuildOrConfigure}`);
}

let buildBeforeLaunch: boolean | undefined;
export function getBuildBeforeLaunch(): boolean | undefined { return buildBeforeLaunch; }
export function setBuildBeforeLaunch(build: boolean): void { buildBeforeLaunch = build; }
export function readBuildBeforeLaunch(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    buildBeforeLaunch = workspaceConfiguration.get<boolean>("buildBeforeLaunch");
    logger.message(`Build before launch: ${buildBeforeLaunch}`);
}

let clearOutputBeforeBuild: boolean | undefined;
export function getClearOutputBeforeBuild(): boolean | undefined { return clearOutputBeforeBuild; }
export function setClearOutputBeforeBuild(clear: boolean): void { clearOutputBeforeBuild = clear; }
export function readClearOutputBeforeBuild(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    clearOutputBeforeBuild = workspaceConfiguration.get<boolean>("clearOutputBeforeBuild");
    logger.message(`Clear output before build: ${clearOutputBeforeBuild}`);
}

// This setting is useful for some repos where directory changing commands (cd, push, pop)
// are missing or printed more than once, resulting in associating some IntelliSense information
// with the wrong file or even with a non existent URL.
// When this is set, the current path deduction relies only on --print-directory
// (which prints the messages regarding "Entering direcory" and "Leaving directory"),
// which is not perfect either for all repos.
let ignoreDirectoryCommands: boolean | undefined;
export function getIgnoreDirectoryCommands(): boolean | undefined { return ignoreDirectoryCommands; }
export function setIgnoreDirectoryCommands(ignore: boolean): void { ignoreDirectoryCommands = ignore; }
export function readIgnoreDirectoryCommands(): void {
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    // how to get default from package.json to avoid problem with 'undefined' type?
    ignoreDirectoryCommands = workspaceConfiguration.get<boolean>("ignoreDirectoryCommands");
    logger.message(`Ignore directory commands: ${ignoreDirectoryCommands}`);
}

// Initialization from settings (or backup default rules), done at activation time
export async function initFromStateAndSettings(): Promise<void> {
    readConfigurationCachePath();
    readMakePath();
    readMakefilePath();
    readBuildLog();
    readPreConfigureScript();
    readAlwaysPreConfigure();
    readDryrunSwitches();
    readAdditionalCompilerNames();
    readExcludeCompilerNames();
    readCurrentMakefileConfiguration();
    readMakefileConfigurations();
    readCurrentTarget();
    readCurrentLaunchConfiguration();
    readDefaultLaunchConfiguration();
    readConfigureOnOpen();
    readConfigureOnEdit();
    readConfigureAfterCommand();
    readPhonyOnlyTargets();
    readSaveBeforeBuildOrConfigure();
    readBuildBeforeLaunch();
    readClearOutputBeforeBuild();
    readIgnoreDirectoryCommands();
    readCompileCommandsPath();

    analyzeConfigureParams();

    await extension._projectOutlineProvider.update(extension.getState().buildConfiguration || "unset",
                                             extension.getState().buildTarget || "unset",
                                             extension.getState().launchConfiguration || "unset");

    // Verify the dirty state of the IntelliSense config provider and update accordingly.
    // The makefile.configureOnEdit setting can be set to false when this behavior is inconvenient.
    vscode.window.onDidChangeActiveTextEditor(async e => {
        let language: string = "";
        if (e) {
            language = e.document.languageId;
        }

        // It is too annoying to generate a configure on any kind of editor focus change
        // (for example even searching in the logging window generates this event).
        // Since all the operations are guarded by the configureDirty state,
        // the only "operation" left that we need to make sure it's up to date
        // is IntelliSense, so trigger a configure when we switch editor focus
        // into C/C++ source code.
        switch (language) {
            case "c":
            case "cpp":
                // If configureDirty is already set from a previous VSCode session,
                // at workspace load this event (onDidChangeActiveTextEditor) is triggered automatically
                // and if makefile.configureOnOpen is true, there is a race between two configure operations,
                // one of which being unnecessary. If configureOnOpen is false, there is no race
                // but still we don't want to override the behavior desired by the user.
                // Additionally, if anything dirtied the configure state during a (pre)configure or build,
                // skip this clean configure, to avoid annoying "blocked operation" notifications.
                // The configure state remains dirty and a new configure will be triggered eventually:
                // (selecting a new configuration, target or launch, build, editor focus change).
                // Guarding only for not being blocked is not enough. For example,
                // in the first scenario explained above, the race happens when nothing looks blocked
                // here, but leading to a block notification soon.
                if (extension.getState().configureDirty && configureOnEdit) {
                    if ((extension.getCompletedConfigureInSession())
                        && !make.blockedByOp(make.Operations.configure, false)) {
                        logger.message("Configuring after settings or makefile changes...");
                        await make.configure(make.TriggeredBy.configureAfterEditorFocusChange); // this sets configureDirty back to false if it succeeds
                    }
                }

                break;

            default:
                break;
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
            extension.getState().configureDirty = true;
        }
    });

    // Watch for Makefile Tools setting updates that can change the IntelliSense config provider dirty state.
    // More than one setting may be updated on one settings.json save,
    // so make sure to OR the dirty state when it's calculated by a formula (not a simple TRUE value).
    vscode.workspace.onDidChangeConfiguration(async e => {
        if (vscode.workspace.workspaceFolders &&
            e.affectsConfiguration('makefile', vscode.workspace.workspaceFolders[0].uri)) {
            // We are interested in updating only some relevant properties.
            // A subset of these should also trigger an IntelliSense config provider update.
            // Avoid unnecessary updates (for example, when settings are modified via the extension quickPick).
            let telemetryProperties: telemetry.Properties | null = {};
            let updatedSettingsSubkeys: string[] = [];
            let keyRoot: string = "makefile";
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(keyRoot);

            let subKey: string = "launchConfigurations";
            let updatedLaunchConfigurations : LaunchConfiguration[] | undefined = workspaceConfiguration.get<LaunchConfiguration[]>(subKey);
            if (!util.areEqual(updatedLaunchConfigurations, launchConfigurations)) {
                // Changing a launch configuration does not impact the make or compiler tools invocations,
                // so no IntelliSense update is needed.
                readCurrentLaunchConfiguration(); // this gets a refreshed view of all launch configurations
                // and also updates the current one in case it was affected
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "defaultLaunchConfiguration";
            let updatedDefaultLaunchConfiguration : DefaultLaunchConfiguration | undefined = workspaceConfiguration.get<DefaultLaunchConfiguration>(subKey);
            if (!util.areEqual(updatedDefaultLaunchConfiguration, defaultLaunchConfiguration)) {
                // Changing a global debug configuration does not impact the make or compiler tools invocations,
                // so no IntelliSense update is needed.
                readDefaultLaunchConfiguration();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "loggingLevel";
            let updatedLoggingLevel : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedLoggingLevel !== loggingLevel) {
                readLoggingLevel();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "buildLog";
            let updatedBuildLog : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedBuildLog) {
                updatedBuildLog = util.resolvePathToRoot(updatedBuildLog);
            }
            if (updatedBuildLog !== buildLog) {
                // Configure is dirty only if the current configuration
                // doesn't have already another build log set
                // (which overrides the global one).
                let currentMakefileConfiguration: MakefileConfiguration | undefined = makefileConfigurations.find(k => {
                    if (k.name === getCurrentMakefileConfiguration()) {
                        return k;
                    }
                });

                extension.getState().configureDirty = extension.getState().configureDirty ||
                                                      !currentMakefileConfiguration || !currentMakefileConfiguration.buildLog;
                readBuildLog();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "extensionOutputFolder";
            let updatedExtensionOutputFolder : string | undefined = workspaceConfiguration.get<string>(subKey);
            let switchedToDefault: boolean = false;
            if (updatedExtensionOutputFolder) {
                updatedExtensionOutputFolder = util.resolvePathToRoot(updatedExtensionOutputFolder);
                if (!util.checkDirectoryExistsSync(updatedExtensionOutputFolder)) {
                    logger.message(`Provided extension output folder does not exist: ${updatedExtensionOutputFolder}.`);
                    let defaultExtensionOutputFolder: string | undefined = workspaceConfiguration.inspect<string>(subKey)?.defaultValue;
                    if (defaultExtensionOutputFolder) {
                        logger.message(`Switching to default: ${defaultExtensionOutputFolder}.`);
                        updatedExtensionOutputFolder = util.resolvePathToRoot(defaultExtensionOutputFolder);
                        // This will trigger another settings changed event
                        workspaceConfiguration.update(subKey, defaultExtensionOutputFolder);
                        updatedSettingsSubkeys.push(subKey);
                        // to prevent the below readExtensionOutputFolder to be executed now,
                        // it will during the next immediate changed event
                        switchedToDefault = true;
                    }
                }
            }
            if (updatedExtensionOutputFolder !== extensionOutputFolder && !switchedToDefault) {
                // No IntelliSense update needed.
                readExtensionOutputFolder();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "extensionLog";
            let updatedExtensionLog : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedExtensionLog) {
                // If there is a directory defined within the extension log path,
                // honor it and don't append to extensionOutputFolder.
                let parsePath: path.ParsedPath = path.parse(updatedExtensionLog);
                if (extensionOutputFolder && !parsePath.dir) {
                    updatedExtensionLog = path.join(extensionOutputFolder, updatedExtensionLog);
                } else {
                    updatedExtensionLog = util.resolvePathToRoot(updatedExtensionLog);
                }
            }
            if (updatedExtensionLog !== extensionLog) {
                // No IntelliSense update needed.
                readExtensionLog();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "preConfigureScript";
            let updatedPreConfigureScript : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedPreConfigureScript) {
                updatedPreConfigureScript = util.resolvePathToRoot(updatedPreConfigureScript);
            }
            if (updatedPreConfigureScript !== preConfigureScript) {
                // No IntelliSense update needed.
                readPreConfigureScript();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "alwaysPreConfigure";
            let updatedAlwaysPreConfigure : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedAlwaysPreConfigure !== alwaysPreConfigure) {
                // No IntelliSense update needed.
                readAlwaysPreConfigure();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "configurationCachePath";
            let updatedConfigurationCachePath : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedConfigurationCachePath) {
                // If there is a directory defined within the configuration cache path,
                // honor it and don't append to extensionOutputFolder.
                let parsePath: path.ParsedPath = path.parse(updatedConfigurationCachePath);
                if (extensionOutputFolder && !parsePath.dir) {
                    updatedConfigurationCachePath = path.join(extensionOutputFolder, updatedConfigurationCachePath);
                } else {
                    updatedConfigurationCachePath = util.resolvePathToRoot(updatedConfigurationCachePath);
                }
            }
            if (updatedConfigurationCachePath !== configurationCachePath) {
                // A change in makefile.configurationCachePath should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                extension.getState().configureDirty = extension.getState().configureDirty ||
                                                      !buildLog || !util.checkFileExistsSync(buildLog);
                readConfigurationCachePath();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "makePath";
            let updatedMakePath : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedMakePath !== makePath) {
                // Not very likely, but it is safe to consider that a different make tool
                // may produce a different dry-run output with potential impact on IntelliSense,
                // so trigger an update (unless we read from a build log).
                extension.getState().configureDirty = extension.getState().configureDirty ||
                                                      !buildLog || !util.checkFileExistsSync(buildLog);
                readMakePath();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "makefilePath";
            let updatedMakefilePath : string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedMakefilePath) {
                updatedMakefilePath = util.resolvePathToRoot(updatedMakefilePath);
            }
            if (updatedMakefilePath !== makefilePath) {
                // A change in makefile.makefilePath should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                extension.getState().configureDirty = extension.getState().configureDirty ||
                                                      !buildLog || !util.checkFileExistsSync(buildLog);
                readMakefilePath();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "configurations";
            let updatedMakefileConfigurations : MakefileConfiguration[] | undefined = workspaceConfiguration.get<MakefileConfiguration[]>(subKey);
            if (!util.areEqual(updatedMakefileConfigurations, makefileConfigurations)) {
                // todo: skip over updating the IntelliSense configuration provider if the current makefile configuration
                // is not among the subobjects that suffered modifications.
                extension.getState().configureDirty = true;
                readMakefileConfigurations();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "dryrunSwitches";
            let updatedDryrunSwitches : string[] | undefined = workspaceConfiguration.get<string[]>(subKey);
            if (!util.areEqual(updatedDryrunSwitches, dryrunSwitches)) {
                // A change in makefile.dryrunSwitches should trigger an IntelliSense update
                // only if the extension is not currently reading from a build log.
                extension.getState().configureDirty = extension.getState().configureDirty ||
                                                      !buildLog || !util.checkFileExistsSync(buildLog);
                readDryrunSwitches();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "additionalCompilerNames";
            let updatedAdditionalCompilerNames : string[] | undefined = workspaceConfiguration.get<string[]>(subKey);
            if (!util.areEqual(updatedAdditionalCompilerNames, additionalCompilerNames)) {
                readAdditionalCompilerNames();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "excludeCompilerNames";
            let updatedExcludeCompilerNames : string[] | undefined = workspaceConfiguration.get<string[]>(subKey);
            if (!util.areEqual(updatedExcludeCompilerNames, excludeCompilerNames)) {
                readExcludeCompilerNames();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "configureOnOpen";
            let updatedConfigureOnOpen : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedConfigureOnOpen !== configureOnOpen) {
                readConfigureOnOpen();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "configureOnEdit";
            let updatedConfigureOnEdit : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedConfigureOnEdit !== configureOnEdit) {
                readConfigureOnEdit();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "configureAfterCommand";
            let updatedConfigureAfterCommand : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedConfigureAfterCommand !== configureAfterCommand) {
                readConfigureAfterCommand();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "phonyOnlyTargets";
            let updatedPhonyOnlyTargets : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedPhonyOnlyTargets !== phonyOnlyTargets) {
                readPhonyOnlyTargets();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "saveBeforeBuildOrConfigure";
            let updatedSaveBeforeBuildOrConfigure : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedSaveBeforeBuildOrConfigure !== saveBeforeBuildOrConfigure) {
                readSaveBeforeBuildOrConfigure();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "buildBeforeLaunch";
            let updatedBuildBeforeLaunch : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedBuildBeforeLaunch !== buildBeforeLaunch) {
                readBuildBeforeLaunch();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "clearOutputBeforeBuild";
            let updatedClearOutputBeforeBuild : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedClearOutputBeforeBuild !== clearOutputBeforeBuild) {
                readClearOutputBeforeBuild();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "ignoreDirectoryCommands";
            let updatedIgnoreDirectoryCommands : boolean | undefined = workspaceConfiguration.get<boolean>(subKey);
            if (updatedIgnoreDirectoryCommands !== ignoreDirectoryCommands) {
                readIgnoreDirectoryCommands();
                updatedSettingsSubkeys.push(subKey);
            }

            subKey = "compileCommandsPath";
            let updatedCompileCommandsPath: string | undefined = workspaceConfiguration.get<string>(subKey);
            if (updatedCompileCommandsPath) {
                updatedCompileCommandsPath = util.resolvePathToRoot(updatedCompileCommandsPath);
            }
            if (updatedCompileCommandsPath !== compileCommandsPath) {
                readCompileCommandsPath();
                updatedSettingsSubkeys.push(subKey);
            }

            // Final updates in some constructs that depend on more than one of the above settings.
            if (extension.getState().configureDirty) {
                analyzeConfigureParams();
            }

            // Report all the settings changes detected by now.
            // TODO: to avoid unnecessary telemetry processing, evaluate whether the changes done
            // in the object makefile.launchConfigurations and makefile.configurations
            // apply exactly to the current launch configuration, since we don't collect and aggregate
            // information from all the array yet.
            updatedSettingsSubkeys.forEach(subKey => {
                let key: string = keyRoot + "." + subKey;
                logger.message(`${key} setting changed.`, "Verbose");
                try {
                    telemetryProperties = telemetry.analyzeSettings(workspaceConfiguration[subKey], key,
                        util.thisExtensionPackage().contributes.configuration.properties[key],
                        false, telemetryProperties);
                } catch (e) {
                    logger.message(e.message);
                }
            });

            if (telemetryProperties && util.hasProperties(telemetryProperties)) {
                telemetry.logEvent("settingsChanged", telemetryProperties);
            }
        }
      });
}

export function setConfigurationByName(configurationName: string): void {
    extension.getState().buildConfiguration = configurationName;
    setCurrentMakefileConfiguration(configurationName);
    extension._projectOutlineProvider.updateConfiguration(configurationName);
}

export function prepareConfigurationsQuickPick(): string[] {
    const items: string[] = makefileConfigurations.map((k => {
        return k.name;
    }));

    if (items.length === 0) {
        logger.message("No configurations defined in makefile.configurations setting.");
        items.push("Default");
    }

    return items;
}

// Fill a drop-down with all the configuration names defined by the user in makefile.configurations setting.
// Triggers a cpptools configuration provider update after selection.
export async function setNewConfiguration(): Promise<void> {
    // Cannot set a new makefile configuration if the project is currently building or (pre-)configuring.
    if (make.blockedByOp(make.Operations.changeConfiguration)) {
        return;
    }

    const items: string[] = prepareConfigurationsQuickPick();

    let options: vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus
    const chosen: string | undefined = await vscode.window.showQuickPick(items, options);
    if (chosen && chosen !== getCurrentMakefileConfiguration()) {
        let telemetryProperties: telemetry.Properties | null = {
            state: "makefileConfiguration"
        };
        telemetry.logEvent("stateChanged", telemetryProperties);

        setConfigurationByName(chosen);

        if (configureAfterCommand) {
            logger.message("Automatically reconfiguring the project after a makefile configuration change.");
            await make.configure(make.TriggeredBy.configureAfterConfigurationChange);
        }

        // Refresh telemetry for this new makefile configuration
        // (this will find the corresponding item in the makefile.configurations array
        // and report all the relevant settings of that object).
        // Because of this, the event name is still "settingsChanged", even if
        // we're doing a state change now.
        let keyRoot: string = "makefile";
        let subKey: string = "configurations";
        let key: string = keyRoot + "." + subKey;
        let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(keyRoot);
        telemetryProperties = {};

        // We should have at least one item in the configurations array
        // if the extension changes state for launch configuration,
        // but guard just in case.
        let makefileonfigurationSetting: any = workspaceConfiguration[subKey];
        if (makefileonfigurationSetting) {
            try {
                telemetryProperties = telemetry.analyzeSettings(makefileonfigurationSetting, key,
                    util.thisExtensionPackage().contributes.configuration.properties[key],
                    true, telemetryProperties);
            } catch (e) {
                logger.message(e.message);
            }

            if (telemetryProperties && util.hasProperties(telemetryProperties)) {
                telemetry.logEvent("settingsChanged", telemetryProperties);
            }
        }
    }
}

export function setTargetByName(targetName: string) : void {
    currentTarget = targetName;
    let displayTarget: string = targetName ? currentTarget : "Default";
    statusBar.setTarget(displayTarget);
    logger.message("Setting target " + displayTarget);
    extension.getState().buildTarget = currentTarget;
    extension._projectOutlineProvider.updateBuildTarget(targetName);
}

// Fill a drop-down with all the target names run by building the makefile for the current configuration
// Triggers a cpptools configuration provider update after selection.
// TODO: change the UI list to multiple selections mode and store an array of current active targets
export async function selectTarget(): Promise<void> {
    // Cannot select a new target if the project is currently building or (pre-)configuring.
    if (make.blockedByOp(make.Operations.changeBuildTarget)) {
        return;
    }

    // warn about an out of date configure state and configure if makefile.configureAfterCommand allows.
    if (extension.getState().configureDirty ||
        // The configure state might not be dirty from the last session but if the project is set to skip
        // configure on open and no configure happened yet we still must warn.
        (configureOnOpen === false && !extension.getCompletedConfigureInSession())) {
        logger.message("The project needs a configure to populate the build targets correctly.");
        if (configureAfterCommand) {
            let retc: number = await make.configure(make.TriggeredBy.configureBeforeTargetChange);
            if (retc !== make.ConfigureBuildReturnCodeTypes.success) {
                logger.message("The build targets list may not be accurate because configure failed.");
            }
        }
    }

    let options: vscode.QuickPickOptions = {};
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

    if (chosen && chosen !== getCurrentTarget()) {
        const telemetryProperties: telemetry.Properties = {
            state: "buildTarget"
        };
        telemetry.logEvent("stateChanged", telemetryProperties);

        setTargetByName(chosen);

        if (configureAfterCommand) {
            // The set of build targets remains the same even if the current target has changed
            logger.message("Automatically reconfiguring the project after a build target change.");
            await make.configure(make.TriggeredBy.configureAfterTargetChange, false);
        }
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
export async function setLaunchConfigurationByName(launchConfigurationName: string) : Promise<void> {
    // Find the matching entry in the array of launch configurations
    // or generate a new entry in settings if none are found.
    currentLaunchConfiguration = getLaunchConfiguration(launchConfigurationName);
    if (!currentLaunchConfiguration) {
        currentLaunchConfiguration = await stringToLaunchConfiguration(launchConfigurationName);
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
        extension.getState().launchConfiguration = launchConfigurationName;
        statusBar.setLaunchConfiguration(launchConfigurationName);
    } else {
        if (launchConfigurationName === "") {
            logger.message("Unsetting the current launch configuration.");
        } else {
            logger.message(`A problem occured while analyzing launch configuration name ${launchConfigurationName}. Current launch configuration is unset.`);
        }
        extension.getState().launchConfiguration = undefined;
        statusBar.setLaunchConfiguration("No launch configuration set");
    }

    await extension._projectOutlineProvider.updateLaunchTarget(launchConfigurationName);
}

// Fill a drop-down with all the launch configurations found for binaries built by the makefile
// under the scope of the current build configuration and target
// Selection updates current launch configuration that will be ready for the next debug/run operation
export async function selectLaunchConfiguration(): Promise<void> {
    // Cannot select a new launch configuration if the project is currently building or (pre-)configuring.
    if (make.blockedByOp(make.Operations.changeLaunchTarget)) {
        return;
    }

    // warn about an out of date configure state and configure if makefile.configureAfterCommand allows.
    if (extension.getState().configureDirty ||
        // The configure state might not be dirty from the last session but if the project is set to skip
        // configure on open and no configure happened yet we still must warn.
        (configureOnOpen === false && !extension.getCompletedConfigureInSession())) {
        logger.message("The project needs a configure to populate the launch targets correctly.");
        if (configureAfterCommand) {
            let retc: number = await make.configure(make.TriggeredBy.configureBeforeLaunchTargetChange);
            if (retc !== make.ConfigureBuildReturnCodeTypes.success) {
                logger.message("The launch targets list may not be accurate because configure failed.");
            }
        }
    }

    // TODO: create a quick pick with description and details for items
    // to better view the long targets commands

    // In the quick pick, include also any makefile.launchConfigurations entries,
    // as long as they exist on disk and without allowing duplicates.
    let launchTargetsNames: string[] = launchTargets;
    launchConfigurations.forEach(launchConfiguration => {
        if (util.checkFileExistsSync(launchConfiguration.binaryPath)) {
            launchTargetsNames.push(launchConfigurationToString(launchConfiguration));
        }
    });
    launchTargetsNames = util.sortAndRemoveDuplicates(launchTargetsNames);
    let options: vscode.QuickPickOptions = {};
    options.ignoreFocusOut = true; // so that the logger and the quick pick don't compete over focus
    if (launchTargets.length === 0) {
        options.placeHolder = "No launch targets identified";
    }
    const chosen: string | undefined = await vscode.window.showQuickPick(launchTargetsNames, options);

    if (chosen) {
        let currentLaunchConfiguration: LaunchConfiguration | undefined = getCurrentLaunchConfiguration();
        if (!currentLaunchConfiguration || chosen !== launchConfigurationToString(currentLaunchConfiguration)) {
            let telemetryProperties: telemetry.Properties | null = {
                state: "launchConfiguration"
            };
            telemetry.logEvent("stateChanged", telemetryProperties);

            await setLaunchConfigurationByName(chosen);

            // Refresh telemetry for this new launch configuration
            // (this will find the corresponding item in the makefile.launchConfigurations array
            // and report all the relevant settings of that object).
            // Because of this, the event name is still "settingsChanged", even if
            // we're doing a state change now.
            let keyRoot: string = "makefile";
            let subKey: string = "launchConfigurations";
            let key: string = keyRoot + "." + subKey;
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(keyRoot);
            telemetryProperties = {};

            // We should have at least one item in the launchConfigurations array
            // if the extension changes state for launch configuration,
            // but guard just in case.
            let launchConfigurationSetting: any = workspaceConfiguration[subKey];
            if (launchConfigurationSetting) {
                try {
                    telemetryProperties = telemetry.analyzeSettings(launchConfigurationSetting, key,
                        util.thisExtensionPackage().contributes.configuration.properties[key],
                        true, telemetryProperties);
                } catch (e) {
                    logger.message(e.message);
                }

                if (telemetryProperties && util.hasProperties(telemetryProperties)) {
                    telemetry.logEvent("settingsChanged", telemetryProperties);
                }
            }
        }
    }
}

// List of targets defined in the makefile project.
// Parsed from the build log, configuration cache or live dry-run output at configure time.
// Currently, this list contains any abstract intermediate target
// (like any object produced by the compiler from a source code file).
// TODO: filter only the relevant targets (binaries, libraries, etc...) from this list.
let buildTargets: string[] = [];
export function getBuildTargets(): string[] { return buildTargets; }
export function setBuildTargets(targets: string[]): void { buildTargets = targets; }

// List of all the binaries built by the current project and all the ways
// they may be invoked (from what cwd, with what arguments).
// This is parsed from the build log, configuration cache or live dry-run output at configure time.
// This is what populates the 'launch targets' quick pick and is different than the
// launch configurations defined in settings.
// A launch configuration extends a launch target with various debugger settings.
// Each launch configuration entry is written in settings by the extension
// when the user actively selects any launch target from the quick pick.
// Then the user can add any of the provided extra attributes (miMode, miDebuggerPath, etc...)
// under that entry. It is possible that not all launch targets have a launch configuration counterpart,
// but if they do it is only one. Technically, we can imagine one launch target may have
// more than one launch configurations defined in settings (same binary, location and arguments debugged
// with different scenarios)) but this is not yet supported because currently the launch configurations
// are uniquely referenced by a string formed by cwd, binary and args (which form a launch target).
// The quick pick is not populated by the launch configurations list because its entries may be
// out of date and most importantly a subset. We want the quick pick to reflect all the possibilities
// that are found available with the current configuration of the project.
let launchTargets: string[] = [];
export function getLaunchTargets(): string[] { return launchTargets; }
export function setLaunchTargets(targets: string[]): void { launchTargets = targets; }

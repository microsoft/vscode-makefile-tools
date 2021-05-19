// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Makefile Tools extension

import * as configuration from './configuration';
import * as cpptools from './cpptools';
import * as launch from './launch';
import * as fs from 'fs';
import * as logger from './logger';
import * as make from './make';
import * as parser from './parser';
import * as path from 'path';
import * as state from './state';
import * as telemetry from './telemetry';
import * as tree from './tree';
import * as ui from './ui';
import * as util from './util';
import * as vscode from 'vscode';
import * as cpp from 'vscode-cpptools';

let statusBar: ui.UI = ui.getUI();
let launcher: launch.Launcher = launch.getLauncher();

export let extension: MakefileToolsExtension;

export class MakefileToolsExtension {
    public readonly _projectOutlineProvider = new tree.ProjectOutlineProvider();
    private readonly _projectOutlineTreeView = vscode.window.createTreeView('makefile.outline', {
        treeDataProvider: this._projectOutlineProvider,
        showCollapseAll: false
    });

    private readonly cppConfigurationProvider = new cpptools.CppConfigurationProvider();
    public getCppConfigurationProvider(): cpptools.CppConfigurationProvider { return this.cppConfigurationProvider; }

    private mementoState = new state.StateManager(this.extensionContext);
    private cppToolsAPI?: cpp.CppToolsApi;
    private cppConfigurationProviderRegister?: Promise<void>;
    private compilerFullPath ?: string;

    public constructor(public readonly extensionContext: vscode.ExtensionContext) {
    }

    public getState(): state.StateManager { return this.mementoState; }

    public dispose(): void {
        this._projectOutlineTreeView.dispose();
        if (this.cppToolsAPI) {
            this.cppToolsAPI.dispose();
        }
    }

    // Used for calling cppToolsAPI.notifyReady only once in a VSCode session.
    private ranNotifyReadyInSession: boolean = false;
    public getRanNotifyReadyInSession() : boolean { return this.ranNotifyReadyInSession; }
    public setRanNotifyReadyInSession(ran: boolean) : void { this.ranNotifyReadyInSession = ran; }

    // Similar to state.ranConfigureInCodebaseLifetime, but at the scope of a VSCode session
    private completedConfigureInSession: boolean = false;
    public getCompletedConfigureInSession() : boolean | undefined { return this.completedConfigureInSession; }
    public setCompletedConfigureInSession(completed: boolean) : void { this.completedConfigureInSession = completed; }

    // Register this extension as a new provider or request an update
    public async registerCppToolsProvider(): Promise<void> {
        await this.ensureCppToolsProviderRegistered();

        // Call notifyReady earlier than when the provider is updated,
        // as soon as we know that we are going to actually parse for IntelliSense.
        // This allows CppTools to ask earlier about source files in use
        // and Makefile Tools may return a targeted source file configuration
        // if it was already computed in our internal arrays (make.ts: customConfigProviderItems).
        // If the requested file isn't yet processed, it will get updated when configure is finished.
        // TODO: remember all requests that are coming and send an update as soon as we detect
        // any of them being pushed into make.customConfigProviderItems.
        if (this.cppToolsAPI) {
            if (!this.ranNotifyReadyInSession && this.cppToolsAPI.notifyReady) {
                this.cppToolsAPI.notifyReady(this.cppConfigurationProvider);
                this.setRanNotifyReadyInSession(true);
            }
        }
    }

    // Request a custom config provider update.
    public updateCppToolsProvider(): void {
        this.cppConfigurationProvider.logConfigurationProviderBrowse();

        if (this.cppToolsAPI) {
            this.cppToolsAPI.didChangeCustomConfiguration(this.cppConfigurationProvider);
        }
    }

    public ensureCppToolsProviderRegistered(): Promise<void> {
        // make sure this extension is registered as provider only once
        if (!this.cppConfigurationProviderRegister) {
            this.cppConfigurationProviderRegister = this.registerCppTools();
        }

        return this.cppConfigurationProviderRegister;
    }

    public getCppToolsVersion(): cpp.Version | undefined {
        return this.cppToolsAPI?.getVersion();
    }

    public async registerCppTools(): Promise<void> {
        if (!this.cppToolsAPI) {
            this.cppToolsAPI = await cpp.getCppToolsApi(cpp.Version.v4);
        }

        if (this.cppToolsAPI) {
            this.cppToolsAPI.registerCustomConfigurationProvider(this.cppConfigurationProvider);
        }
    }

    private cummulativeBrowsePath: string[] = [];
    public clearCummulativeBrowsePath(): void {
        this.cummulativeBrowsePath = [];
    }

    public buildCustomConfigurationProvider(customConfigProviderItem: parser.CustomConfigProviderItem): void {
        this.compilerFullPath = customConfigProviderItem.compilerFullPath;
        let provider: cpptools.CustomConfigurationProvider = make.getDeltaCustomConfigurationProvider();

        const configuration: cpp.SourceFileConfiguration = {
            defines: customConfigProviderItem.defines,
            standard: customConfigProviderItem.standard || "c++17",
            includePath: customConfigProviderItem.includes,
            forcedInclude: customConfigProviderItem.forcedIncludes,
            intelliSenseMode: customConfigProviderItem.intelliSenseMode,
            compilerPath: customConfigProviderItem.compilerFullPath,
            compilerArgs: customConfigProviderItem.compilerArgs,
            windowsSdkVersion: customConfigProviderItem.windowsSDKVersion
        };

        // cummulativeBrowsePath incorporates all the files and the includes paths
        // of all the compiler invocations of the current configuration
        customConfigProviderItem.files.forEach(filePath => {
            let uri: vscode.Uri = vscode.Uri.file(filePath);
            let sourceFileConfigurationItem: cpptools.SourceFileConfigurationItem = {
                uri,
                configuration,
                compileCommand: {
                   command: customConfigProviderItem.line,
                   directory: customConfigProviderItem.currentPath,
                   file: filePath
                }
            };

            // These are the configurations processed during the current configure.
            // Store them in the 'delta' file index instead of the final one.
            provider.fileIndex.set(path.normalize(uri.fsPath), sourceFileConfigurationItem);
            extension.getCppConfigurationProvider().logConfigurationProviderItem(sourceFileConfigurationItem);

            let folder: string = path.dirname(filePath);
            if (!this.cummulativeBrowsePath.includes(folder)) {
                this.cummulativeBrowsePath.push(folder);
            }
        });

        customConfigProviderItem.includes.forEach(incl => {
            if (!this.cummulativeBrowsePath.includes(incl)) {
                this.cummulativeBrowsePath.push(incl);
            }
        });

        customConfigProviderItem.forcedIncludes.forEach(fincl => {
            let folder: string = path.dirname(fincl);
            if (!this.cummulativeBrowsePath.includes(folder)) {
                this.cummulativeBrowsePath.push(fincl);
            }
        });

        provider.workspaceBrowse = {
            browsePath: this.cummulativeBrowsePath,
            standard: customConfigProviderItem.standard,
            compilerPath: customConfigProviderItem.compilerFullPath,
            compilerArgs: customConfigProviderItem.compilerArgs,
            windowsSdkVersion: customConfigProviderItem.windowsSDKVersion
        };

        make.setCustomConfigurationProvider(provider);
    }

    public getCompilerFullPath() : string | undefined { return this.compilerFullPath; }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    statusBar = ui.getUI();
    extension = new MakefileToolsExtension(context);

    telemetry.activate();

    context.subscriptions.push(vscode.commands.registerCommand('makefile.setBuildConfiguration', async () => {
        await configuration.setNewConfiguration();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.setBuildTarget', async () => {
       await configuration.selectTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildTarget', async () => {
        await make.buildTarget(make.TriggeredBy.buildTarget, configuration.getCurrentTarget() || "", false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildCleanTarget', async () => {
        await make.buildTarget(make.TriggeredBy.buildCleanTarget, configuration.getCurrentTarget() || "", true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildAll', async () => {
        await make.buildTarget(make.TriggeredBy.buildAll, "all", false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildCleanAll', async () => {
        await make.buildTarget(make.TriggeredBy.buildCleanAll, "all", true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.setLaunchConfiguration', async () => {
        await configuration.selectLaunchConfiguration();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchDebug', async () => {
        await launcher.debugCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchRun', async () => {
        await launcher.runCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.getLaunchTargetPath', () => {
        telemetry.logEvent("getLaunchTargetPath");
        return launcher.getLaunchTargetPath();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetPath', () => {
      telemetry.logEvent("launchTargetPath");
      return launcher.launchTargetPath();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.getLaunchTargetDirectory', () => {
        telemetry.logEvent("getLaunchTargetDirectory");
        return launcher.getLaunchTargetDirectory();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.getLaunchTargetFileName', () => {
      telemetry.logEvent("getLaunchTargetFileName");
      return launcher.getLaunchTargetFileName();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetFileName', () => {
      telemetry.logEvent("launchTargetFileName");
      return launcher.launchTargetFileName();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.getLaunchTargetArgs', () => {
        telemetry.logEvent("getLaunchTargetArgs");
        return launcher.getLaunchTargetArgs();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.getLaunchTargetArgsConcat', () => {
        telemetry.logEvent("getLaunchTargetArgsConcat");
        return launcher.getLaunchTargetArgsConcat();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.configure', async () => {
        await make.configure(make.TriggeredBy.configure);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.cleanConfigure', async () => {
        await make.cleanConfigure(make.TriggeredBy.cleanConfigure);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.preConfigure', async () => {
        await make.preConfigure(make.TriggeredBy.preconfigure);
    }));

    // Reset state - useful for troubleshooting.
    context.subscriptions.push(vscode.commands.registerCommand('makefile.resetState', () => {
        telemetry.logEvent("commandResetState");
        extension.getState().reset();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.configure', () => {
        return vscode.commands.executeCommand("makefile.configure");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.cleanConfigure', () => {
        return vscode.commands.executeCommand("makefile.cleanConfigure");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.preConfigure', () => {
        return vscode.commands.executeCommand("makefile.preConfigure");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.setLaunchConfiguration', () => {
        return vscode.commands.executeCommand("makefile.setLaunchConfiguration");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.launchDebug', () => {
        return vscode.commands.executeCommand("makefile.launchDebug");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.launchRun', () => {
        return vscode.commands.executeCommand("makefile.launchRun");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.setBuildTarget', () => {
        return vscode.commands.executeCommand("makefile.setBuildTarget");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.buildTarget', () => {
        return vscode.commands.executeCommand("makefile.buildTarget");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.buildCleanTarget', () => {
        return vscode.commands.executeCommand("makefile.buildCleanTarget");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.outline.setBuildConfiguration', () => {
        return vscode.commands.executeCommand("makefile.setBuildConfiguration");
    }));

    configuration.readLoggingLevel();
    configuration.readExtensionOutputFolder();
    configuration.readExtensionLog();

    // Delete the extension log file, if exists
    let extensionLog : string | undefined = configuration.getExtensionLog();
    if (extensionLog && util.checkFileExistsSync(extensionLog)) {
        fs.unlinkSync(extensionLog);
    }

    // Read configuration info from settings
    await configuration.initFromStateAndSettings();

    if (configuration.getConfigureOnOpen()) {
        // Always clean configure on open
        await make.cleanConfigure(make.TriggeredBy.cleanConfigureOnOpen);
    }

    // Analyze settings for type validation and telemetry
    let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
    let telemetryProperties: telemetry.Properties | null = {};
    try {
        telemetryProperties = telemetry.analyzeSettings(workspaceConfiguration, "makefile",
            util.thisExtensionPackage().contributes.configuration.properties,
            true, telemetryProperties);
    } catch (e) {
        logger.message(e.message);
    }

    if (telemetryProperties && util.hasProperties(telemetryProperties)) {
        telemetry.logEvent("settings", telemetryProperties);
    }
}

export async function deactivate(): Promise<void> {
    vscode.window.showInformationMessage('The extension "vscode-makefile-tools" is de-activated');

    await telemetry.deactivate();

    const items : any = [
        extension,
        launcher,
        statusBar
    ];

    for (const item of items) {
        if (item) {
            item.dispose();
        }
    }
}

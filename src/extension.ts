// Makefile Tools extension

import * as configuration from './configuration';
import * as cpptools from './cpptools';
import * as launch from './launch';
import * as fs from 'fs';
import * as logger from './logger';
import * as make from './make';
import * as parser from './parser';
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
    private mementoState = new state.StateManager(this.extensionContext);
    private cppToolsAPI?: cpp.CppToolsApi;
    private cppConfigurationProviderRegister?: Promise<void>;
    private compilerFullPath ?: string;

    public constructor(public readonly extensionContext: vscode.ExtensionContext) {
    }

    public getState(): state.StateManager { return this.mementoState; }

    // Parse the dry-run output and populate data for cpptools
    public constructIntellisense(dryRunOutputStr: string): void {
        parser.parseForCppToolsCustomConfigProvider(dryRunOutputStr);
    }

    public emptyCustomConfigurationProvider() : void {
        this.cppConfigurationProvider.empty();
    }

    public dispose(): void {
        this._projectOutlineTreeView.dispose();
        if (this.cppToolsAPI) {
            this.cppToolsAPI.dispose();
        }
    }

    // Register this extension as a new provider or request an update
    public async registerCppToolsProvider(): Promise<void> {
        await this.ensureCppToolsProviderRegistered();
    }

    // Similar to state.ranConfigureInCodebaseLifetime, but within the scope of a VSCode session.
    private ranConfigureInSession: boolean = false;
    public getRanConfigureInSession() : boolean { return this.ranConfigureInSession; }

    // Request a custom config provider update.
    public async updateCppToolsProvider(): Promise<void> {
        this.cppConfigurationProvider.logConfigurationProvider();

        if (this.cppToolsAPI) {
            if (!this.ranConfigureInSession && this.cppToolsAPI.notifyReady) {
                this.cppToolsAPI.notifyReady(this.cppConfigurationProvider);
                this.ranConfigureInSession = true;
            } else {
                this.cppToolsAPI.didChangeCustomConfiguration(this.cppConfigurationProvider);
            }
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

    public buildCustomConfigurationProvider(
        defines: string[],
        includePath: string[],
        forcedInclude: string[],
        standard: util.StandardVersion,
        intelliSenseMode: util.IntelliSenseMode,
        compilerPath: string,
        filesPaths: string[],
        windowsSdkVersion?: string
    ): void {
        this.compilerFullPath = compilerPath;
        this.cppConfigurationProvider.buildCustomConfigurationProvider(defines, includePath, forcedInclude, standard, intelliSenseMode, compilerPath, filesPaths, windowsSdkVersion);
    }

    public getCompilerFullPath() : string | undefined { return this.compilerFullPath; }
}

// A change of target or configuration triggered a new dry-run,
// which produced a new output string to be parsed
export async function updateProvider(dryRunOutputStr: string): Promise<void> {
    logger.message("Updating the CppTools IntelliSense Configuration Provider.");
    await extension.registerCppToolsProvider();
    extension.emptyCustomConfigurationProvider();
    extension.constructIntellisense(dryRunOutputStr);
    await extension.updateCppToolsProvider();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    statusBar = ui.getUI();
    extension = new MakefileToolsExtension(context);

    telemetry.activate();

    context.subscriptions.push(vscode.commands.registerCommand('makefile.setBuildConfiguration', () => {
        configuration.setNewConfiguration();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.setBuildTarget', () => {
        configuration.selectTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildTarget', () => {
        make.buildTarget(make.TriggeredBy.buildTarget, configuration.getCurrentTarget() || "", false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildCleanTarget', () => {
        make.buildTarget(make.TriggeredBy.buildCleanTarget, configuration.getCurrentTarget() || "", true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildAll', () => {
        make.buildTarget(make.TriggeredBy.buildAll, "all", false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildCleanAll', () => {
        make.buildTarget(make.TriggeredBy.buildCleanAll, "all", true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.setLaunchConfiguration', () => {
        configuration.selectLaunchConfiguration();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchDebug', () => {
        launcher.debugCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchRun', () => {
        launcher.runCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetPath', () => {
        telemetry.logEvent("launchTargetPath");
        return launcher.launchTargetPath();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetDirectory', () => {
        telemetry.logEvent("launchTargetDirectory");
        return launcher.launchTargetDirectory();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetArgs', () => {
        telemetry.logEvent("launchTargetArgs");
        return launcher.launchTargetArgs();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetArgsConcat', () => {
        telemetry.logEvent("launchTargetArgsConcat");
        return launcher.launchTargetArgsConcat();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.configure', () => {
        make.configure(make.TriggeredBy.configure);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.cleanConfigure', () => {
        make.cleanConfigure(make.TriggeredBy.cleanConfigure);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.preConfigure', () => {
        make.preConfigure(make.TriggeredBy.preconfigure);
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
    configuration.readExtensionLog();

    // Delete the extension log file, if exists
    let extensionLog : string | undefined = configuration.getExtensionLog();
    if (extensionLog && util.checkFileExistsSync(extensionLog)) {
        fs.unlinkSync(extensionLog);
    }

    // Read configuration info from settings
    await configuration.initFromStateAndSettings();

    if (configuration.getConfigureOnOpen()) {
        if (extension.getState().configureDirty) {
            await make.cleanConfigure(make.TriggeredBy.cleanConfigureOnOpen);
        } else {
            await make.configure(make.TriggeredBy.configureOnOpen);
        }
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

    telemetry.deactivate();

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

// Makefile Tools extension

import * as configuration from './configuration';
import * as cpptools from './cpptools';
import * as launch from './launch';
import * as fs from 'fs';
import * as logger from './logger';
import * as make from './make';
import * as parser from './parser';
import * as telemetry from './telemetry';
import * as ui from './ui';
import * as util from './util';
import * as vscode from 'vscode';
import * as cpp from 'vscode-cpptools';

let statusBar: ui.UI = ui.getUI();
let launcher: launch.Launcher = launch.getLauncher();

export let extension: MakefileToolsExtension;

export class MakefileToolsExtension {
    private readonly cppConfigurationProvider = new cpptools.CppConfigurationProvider();
    private cppToolsAPI?: cpp.CppToolsApi;
    private cppConfigurationProviderRegister?: Promise<void>;
    private compilerFullPath ?: string;

    public constructor(public readonly extensionContext: vscode.ExtensionContext) {
    }

    // Parse the dry-run output and populate data for cpptools
    public constructIntellisense(dryRunOutputStr: string): void {
        parser.parseForCppToolsCustomConfigProvider(dryRunOutputStr);
    }

    public emptyCustomConfigurationProvider() : void {
        this.cppConfigurationProvider.empty();
    }

    public dispose(): void {
        if (this.cppToolsAPI) {
            this.cppToolsAPI.dispose();
        }
    }

    // Register this extension as a new provider or request an update
    public async registerCppToolsProvider(): Promise<void> {
        await this.ensureCppToolsProviderRegistered();
    }

    // Request a custom config provider update.
    public async updateCppToolsProvider(): Promise<void> {
        this.cppConfigurationProvider.logConfigurationProvider();

        if (this.cppToolsAPI) {
            if (this.cppToolsAPI.notifyReady) {
                this.cppToolsAPI.notifyReady(this.cppConfigurationProvider);
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

    public getCppToolsVersion(): cpp.Version {
        if (this.cppToolsAPI) {
            return this.cppToolsAPI.getVersion();
        }

        return cpp.Version.latest;
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
    extension.registerCppToolsProvider();
    extension.emptyCustomConfigurationProvider();
    extension.constructIntellisense(dryRunOutputStr);
    extension.updateCppToolsProvider();
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
        make.buildTarget(configuration.getCurrentTarget() || "", false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildCleanTarget', () => {
        make.buildTarget(configuration.getCurrentTarget() || "", true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildAll', () => {
        make.buildTarget("all", false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.buildCleanAll', () => {
        make.buildTarget("all", true);
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
        return launcher.launchTargetPath();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetDirectory', () => {
        return launcher.launchTargetDirectory();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetArgs', () => {
        return launcher.launchTargetArgs();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.launchTargetArgsConcat', () => {
        return launcher.launchTargetArgsConcat();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.configure', () => {
        configuration.setConfigureDirty(true);
        make.configure();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.cleanConfigure', () => {
        configuration.setConfigureDirty(true);
        make.cleanConfigure();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('makefile.preConfigure', () => {
        configuration.setConfigureDirty(true);
        make.preConfigure();
    }));

    configuration.readLoggingLevel();
    configuration.readExtensionLog();

    // Delete the extension log file, if exists
    let extensionLog : string | undefined = configuration.getExtensionLog();
    if (extensionLog && util.checkFileExistsSync(extensionLog)) {
        fs.unlinkSync(extensionLog);
    }

    // Read configuration info from settings
    configuration.initFromStateAndSettings();

    // Let's do clean configure on load: meaning to invoke make dryrun
    // instead of reading from the previously saved configuration cache.
    // That is if the user didn't bypass the dryrun via makefile.buildLog.
    configuration.setConfigureDirty(true);
    if (configuration.getConfigureOnOpen()) {
        await make.cleanConfigure();
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

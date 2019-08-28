// Makefile Tools extension

import * as configuration from './configuration';
import * as cpptools from './cpptools';
import * as launch from './launch';
import * as fs from 'fs';
import * as logger from './logger';
import * as make from './make';
import * as parser from './parser';
import * as ui from './ui';
import * as util from './util';
import * as vscode from 'vscode';
import * as cpp from 'vscode-cpptools';

let statusBar: ui.UI = ui.getUI();
let launcher: launch.Launcher = launch.getLauncher();

export let extension: MakefileToolsExtension | null = null;

export class MakefileToolsExtension {
    private readonly cppConfigurationProvider = new cpptools.CppConfigurationProvider();
    private cppToolsAPI?: cpp.CppToolsApi;
    private cppConfigurationProviderRegister?: Promise<void>;

    public constructor(public readonly extensionContext: vscode.ExtensionContext) {
    }

    // Parse the dry-run output and populate data for cpptools
    public constructIntellisense(dryRunOutputStr: string): void {
        parser.parseForCppToolsCustomConfigProvider(dryRunOutputStr);
    }

    public dispose(): void {
        if (this.cppToolsAPI) {
            this.cppToolsAPI.dispose();
        }
    }

    // Register this extension as a new provider or request an update
    public async registerCppToolsProvider(): Promise<void> {
        await this.ensureCppToolsProviderRegistered();

        if (this.cppToolsAPI) {
            this.cppConfigurationProvider.logConfigurationProvider();
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

    public async registerCppTools(): Promise<void> {
        if (!this.cppToolsAPI) {
            this.cppToolsAPI = await cpp.getCppToolsApi(cpp.Version.v2);
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
        windowsSdkVersion: string,
        filesPaths: string[]
    ): void {
        this.cppConfigurationProvider.buildCustomConfigurationProvider(defines, includePath, forcedInclude, standard, intelliSenseMode, compilerPath, windowsSdkVersion, filesPaths);
    }
}

// A change of target or configuration triggered a new dry-run,
// which produced a new output string to be parsed
export async function updateProvider(dryRunOutputStr: string): Promise<void> {
    logger.message("Updating the CppTools IntelliSense Configuration Provider.");
    if (extension) {
        extension.constructIntellisense(dryRunOutputStr);
        extension.registerCppToolsProvider();
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    vscode.window.showInformationMessage('The extension "vscode-makefile-tools" is now active');

    statusBar = ui.getUI();
    extension = new MakefileToolsExtension(context);

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.setBuildConfiguration', () => {
        configuration.setNewConfiguration();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.setBuildTarget', () => {
        configuration.setNewTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.buildTarget', () => {
        let config : string | undefined = configuration.getCurrentMakeConfiguration();
        let target : string | undefined = configuration.getCurrentTarget();
        let configAndTarget : string = '"' + config;

        if (target) {
            target = target.trimLeft();
            if (target !== "") {
                configAndTarget += "/" + target;
            }
        }

        configAndTarget += '"';
        vscode.window.showInformationMessage('Building current makefile configuration ' + configAndTarget);
        make.buildCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.setLaunchConfiguration', () => {
        configuration.setNewLaunchConfiguration();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.launchDebug', () => {
        launcher.debugCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.launchRun', () => {
        launcher.runCurrentTarget();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.launchTargetPath', () => {
        return launcher.launchTargetPath();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.launchCurrentDir', () => {
        return launcher.launchCurrentDir();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.launchTargetArgs', () => {
        return launcher.launchTargetArgs();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('Makefile.launchTargetArgsConcat', () => {
        return launcher.launchTargetArgsConcat();
    }));

    // Read configuration info from settings
    configuration.initFromSettings();

    // Generate the dry-run output used for parsing the info to be sent to CppTools
    make.dryRun();
}

export async function deactivate(): Promise<void> {
    vscode.window.showInformationMessage('The extension "vscode-makefile-tools" is de-activated');

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

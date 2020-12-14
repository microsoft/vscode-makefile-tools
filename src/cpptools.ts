// Support for integration with CppTools Custom Configuration Provider

import * as configuration from './configuration';
import * as logger from './logger';
import * as make from './make';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import * as cpp from 'vscode-cpptools';

export interface CustomConfigurationProvider {
    workspaceBrowse: cpp.WorkspaceBrowseConfiguration;
    fileIndex: Map<string, cpp.SourceFileConfigurationItem>;
}

export class CppConfigurationProvider implements cpp.CustomConfigurationProvider {
    public readonly name = 'Makefile Tools';
    public readonly extensionId = 'ms-vscode.makefile-tools';

    private workspaceBrowseConfiguration: cpp.WorkspaceBrowseConfiguration = { browsePath: [] };

    private getConfiguration(uri: vscode.Uri): cpp.SourceFileConfigurationItem | undefined {
        const norm_path: string = path.normalize(uri.fsPath);

        // First look in the file index computed during the last configure.
        // If nothing is found and there is a configure running right now,
        // try also the temporary index of the current configure.
        let sourceFileConfiguration: cpp.SourceFileConfigurationItem | undefined = this.fileIndex.get(norm_path);
        if (!sourceFileConfiguration && make.getIsConfiguring()) {
            sourceFileConfiguration = make.getDeltaCustomConfigurationProvider().fileIndex.get(norm_path);
            logger.message(`Configuration for file ${norm_path} was not found. Searching in the current configure temporary file index.`);
        }

        if (!sourceFileConfiguration) {
            logger.message(`Configuration for file ${norm_path} was not found. CppTools will set a default configuration.`);
        }

        return sourceFileConfiguration;
    }

    public async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
        return !!this.getConfiguration(uri);
    }

    public async provideConfigurations(uris: vscode.Uri[]): Promise<cpp.SourceFileConfigurationItem[]> {
        return util.dropNulls(uris.map(u => this.getConfiguration(u)));
    }

    // Used when saving all the computed configurations into a cache.
    public getCustomConfigurationProvider(): CustomConfigurationProvider {
        let provider: CustomConfigurationProvider = {
            fileIndex: this.fileIndex,
            workspaceBrowse: this.workspaceBrowseConfiguration
        };

        return provider;
    }

    // Used to reset all the configurations with what was previously cached.
    public setCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        this.fileIndex = provider.fileIndex;
        this.workspaceBrowseConfiguration = provider.workspaceBrowse;
    }

    // Used to merge a new set of configurations on top of what was calculated during the previous configure.
    // If this is clean configure, clear all the arrays before the merge.
    public mergeCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        if (make.getConfigureIsClean()) {
            this.fileIndex.clear();
            this.workspaceBrowseConfiguration = {
                browsePath: [],
                compilerArgs: [],
                compilerPath: undefined,
                standard: undefined,
                windowsSdkVersion: undefined
            };
        }

        let map: Map<string, cpp.SourceFileConfigurationItem> = this.fileIndex;
        provider.fileIndex.forEach(function(value, key) {
            map.set(key, value);
        });

        this.workspaceBrowseConfiguration = {
            browsePath: util.sortAndRemoveDuplicates(this.workspaceBrowseConfiguration.browsePath.concat(provider.workspaceBrowse.browsePath)),
            compilerArgs: this.workspaceBrowseConfiguration.compilerArgs?.concat(provider.workspaceBrowse.compilerArgs || []),
            compilerPath: provider.workspaceBrowse.compilerPath,
            standard: provider.workspaceBrowse.standard,
            windowsSdkVersion: provider.workspaceBrowse.windowsSdkVersion
        };
    }

    public async canProvideBrowseConfiguration(): Promise<boolean> {
        return true;
    }

    public async canProvideBrowseConfigurationsPerFolder(): Promise<boolean> {
        return false;
    }

    public async provideFolderBrowseConfiguration(_uri: vscode.Uri): Promise<cpp.WorkspaceBrowseConfiguration> {
        if (_uri.fsPath !== vscode.workspace.rootPath) {
            logger.message("Makefile Tools supports single root for now.");
        }

        return this.workspaceBrowseConfiguration;
    }

    public async provideBrowseConfiguration(): Promise<cpp.WorkspaceBrowseConfiguration> { return this.workspaceBrowseConfiguration; }
    public setBrowseConfiguration(browseConfiguration: cpp.WorkspaceBrowseConfiguration): void { this.workspaceBrowseConfiguration =  browseConfiguration; }

    public dispose(): void { }

    private fileIndex = new Map<string, cpp.SourceFileConfigurationItem>();

    public logConfigurationProviderBrowse(): void {
        logger.message("Sending Workspace Browse Configuration: -----------------------------------", "Verbose");
        logger.message("    Browse Path: " + this.workspaceBrowseConfiguration.browsePath.join(";"), "Verbose");
        logger.message("    Standard: " + this.workspaceBrowseConfiguration.standard, "Verbose");
        logger.message("    Compiler Path: " + this.workspaceBrowseConfiguration.compilerPath, "Verbose");
        logger.message("    Compiler Arguments: " + this.workspaceBrowseConfiguration.compilerArgs?.join(";"), "Verbose");
        if (process.platform === "win32" && this.workspaceBrowseConfiguration.windowsSdkVersion) {
            logger.message("    Windows SDK Version: " + this.workspaceBrowseConfiguration.windowsSdkVersion, "Verbose");
        }
        logger.message("----------------------------------------------------------------------------", "Verbose");
    }

    public logConfigurationProviderItem(filePath: cpp.SourceFileConfigurationItem, fromCache: boolean = false): void {
        logger.message("Sending configuration " + (fromCache ? "(from cache) " : "") + "for file " + filePath.uri.toString() + " -----------------------------------", "Normal", false);
        logger.message("    Defines: " + filePath.configuration.defines.join(";"), "Verbose", false);
        logger.message("    Includes: " + filePath.configuration.includePath.join(";"), "Verbose", false);
        if (filePath.configuration.forcedInclude) {
            logger.message("    Force Includes: " + filePath.configuration.forcedInclude.join(";"), "Verbose", false);
        }
        logger.message("    Standard: " + filePath.configuration.standard, "Verbose", false);
        logger.message("    IntelliSense Mode: " + filePath.configuration.intelliSenseMode, "Verbose", false);
        logger.message("    Compiler Path: " + filePath.configuration.compilerPath, "Verbose", false);
        logger.message("    Compiler Arguments: " + filePath.configuration.compilerArgs?.join(";"), "Verbose", false);
        if (process.platform === "win32" && filePath.configuration.windowsSdkVersion) {
            logger.message("    Windows SDK Version: " + filePath.configuration.windowsSdkVersion, "Verbose", false);
        }
        logger.message("---------------------------------------------------------------------------------------------------", "Verbose", false);
    }

    public logConfigurationProviderComplete(): void {
        if (configuration.getLoggingLevel() !== "Normal") {
            this.logConfigurationProviderBrowse();

            this.fileIndex.forEach(filePath => {
                // logConfigurationProviderComplete is called (so far) only after loading
                // the configurations from cache, so mark the boolean to be able to distinguish
                // the log entries in case of interleaved output.
                this.logConfigurationProviderItem(filePath, true);
            });
        }
    }
}

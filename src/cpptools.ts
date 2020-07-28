// Support for integration with CppTools Custom Configuration Provider

import * as logger from './logger';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import * as cpp from 'vscode-cpptools';

let cummulativeBrowsePath: string[] = [];
export function clearCummulativeBrowsePath(): void {
    cummulativeBrowsePath = [];
}

export class CppConfigurationProvider implements cpp.CustomConfigurationProvider {
    public readonly name = 'Makefile Tools';
    public readonly extensionId = 'ms-vscode.makefile-tools';

    private workspaceBrowseConfiguration: cpp.WorkspaceBrowseConfiguration = { browsePath: [] };

    private getConfiguration(uri: vscode.Uri): cpp.SourceFileConfigurationItem | undefined {
        const norm_path: string = path.normalize(uri.fsPath);
        return this.fileIndex.get(norm_path);
    }

    public async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
        return !!this.getConfiguration(uri);
    }

    public async provideConfigurations(uris: vscode.Uri[]): Promise<cpp.SourceFileConfigurationItem[]> {
        return util.dropNulls(uris.map(u => this.getConfiguration(u)));
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

    public dispose(): void { }

    // Reset the workspace browse configuration and empty the array of files
    // Used when Makefile Tools extension is performing a configuration change operation.
    // When the new configuration does not contain information about some files
    // that were part of the previous configuration, without this empty helper
    // the IntelliSense information of those files will be preserved
    // when actually it shouldn't.
    public empty() : void {
        this.fileIndex.clear();
        this.workspaceBrowseConfiguration = {
            browsePath: [],
            compilerPath: undefined,
            standard: undefined,
            windowsSdkVersion: undefined
        };
    }

    private readonly fileIndex = new Map<string, cpp.SourceFileConfigurationItem>();

    // TODO: Finalize the content parsed from the dry-run output:
    //     - incorporate relevant settings from the environment
    //           INCLUDE= for include paths
    //           _CL_= parse for defines, undefines, standard and response files
    //                 Attention for defines syntax: _CL_=/DMyDefine#1 versus /DMyDefine=1
    //     - take into account the effect of undefines /U
    // In case of conflicting switches, the command prompt overwrites the makefile
    public buildCustomConfigurationProvider(
        defines: string[],
        includePath: string[],
        forcedInclude: string[],
        standard: util.StandardVersion,
        intelliSenseMode: util.IntelliSenseMode,
        compilerPath: string,
        filesPaths: string[],
        windowsSdkVersion?: string): void {
        const configuration: cpp.SourceFileConfiguration = {
            defines,
            standard : standard || "c++17",
            includePath,
            forcedInclude,
            intelliSenseMode,
            compilerPath,
            windowsSdkVersion
        };

        // cummulativeBrowsePath incorporates all the files and the includes paths
        // of all the compiler invocations of the current configuration
        filesPaths.forEach(filePath => {
            this.fileIndex.set(path.normalize(filePath), {
                uri: vscode.Uri.file(filePath),
                configuration,
            });

            let folder: string = path.dirname(filePath);
            if (!cummulativeBrowsePath.includes(folder)) {
                cummulativeBrowsePath.push(folder);
            }
        });

        includePath.forEach(incl => {
            if (!cummulativeBrowsePath.includes(incl)) {
                cummulativeBrowsePath.push(incl);
            }
        });

        forcedInclude.forEach(fincl => {
            if (!cummulativeBrowsePath.includes(fincl)) {
                cummulativeBrowsePath.push(fincl);
            }
        });

        this.workspaceBrowseConfiguration = {
            browsePath: cummulativeBrowsePath,
            standard,
            compilerPath,
            windowsSdkVersion
        };
    }

    public logConfigurationProvider(): void {
        logger.message("Sending Workspace Browse Configuration: -----------------------------------");
        logger.message("    Browse Path: " + this.workspaceBrowseConfiguration.browsePath.join(";"));
        logger.message("    Standard: " + this.workspaceBrowseConfiguration.standard);
        logger.message("    Compiler Path: " + this.workspaceBrowseConfiguration.compilerPath);
        if (process.platform === "win32" && this.workspaceBrowseConfiguration.windowsSdkVersion) {
            logger.message("    Windows SDK Version: " + this.workspaceBrowseConfiguration.windowsSdkVersion);
        }
        logger.message("----------------------------------------------------------------------------");

        this.fileIndex.forEach(filePath => {
            logger.message("Sending configuration for file " + filePath.uri.toString() + " -----------------------------------");
            logger.message("    Defines: " + filePath.configuration.defines.join(";"));
            logger.message("    Includes: " + filePath.configuration.includePath.join(";"));
            if (filePath.configuration.forcedInclude) {
                logger.message("    Force Includes: " + filePath.configuration.forcedInclude.join(";"));
            }
            logger.message("    Standard: " + filePath.configuration.standard);
            logger.message("    IntelliSense Mode: " + filePath.configuration.intelliSenseMode);
            logger.message("    Compiler Path: " + filePath.configuration.compilerPath);
            if (process.platform === "win32" && filePath.configuration.windowsSdkVersion) {
                logger.message("    Windows SDK Version: " + filePath.configuration.windowsSdkVersion);
            }
            logger.message("---------------------------------------------------------------------------------------------------");
        });
    }
}

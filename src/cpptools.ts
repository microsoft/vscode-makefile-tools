import * as logger from './logger';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import * as cpp from 'vscode-cpptools';

let cummulativeBrowsePath: string[] = [];
export function emptyCummulativeBrowsePath() {
	cummulativeBrowsePath = [];
}

export class CppConfigurationProvider implements cpp.CustomConfigurationProvider {
	readonly name = 'Makefile Tools';

	readonly extensionId = 'microsoft.vscode-makefile-tools';

	private workspaceBrowseConfiguration: cpp.WorkspaceBrowseConfiguration = { browsePath: [] };

	private getConfiguration(uri: vscode.Uri): cpp.SourceFileConfigurationItem | undefined {
		const norm_path = path.normalize(uri.fsPath);
		return this.fileIndex.get(norm_path);
	}

	async canProvideConfiguration(uri: vscode.Uri) {
		return !!this.getConfiguration(uri);
	}


	async provideConfigurations(uris: vscode.Uri[]) {
		return util.dropNulls(uris.map(u => this.getConfiguration(u)));
	}

	async canProvideBrowseConfiguration() {
		return true;
	}

	async provideBrowseConfiguration() { return this.workspaceBrowseConfiguration; }

	dispose() {}

	private readonly fileIndex = new Map<string, cpp.SourceFileConfigurationItem>();

	// TODO: Finalize the content parsed from the dry-run output:
	//     - incorporate relevant settings from the environment
	//           INCLUDE= for include paths
	//           _CL_= parse for defines, undefines, standard and response files
	//                 Attention for defines syntax: _CL_=/DMyDefine#1 versus /DMyDefine1
	//     - take into account the effect of undefines /U
	// In case of conflicting switches, the command prompt overwrites the makefile
	buildCustomConfigurationProvider(
		defines: string[],
		includePath: string[],
		forcedInclude: string[],
		standard: util.StandardVersion,
		intelliSenseMode: util.IntelliSenseMode,
		compilerPath: string,
		windowsSdkVersion: string,
		filesPaths: string[]) {
		const configuration: cpp.SourceFileConfiguration = {
			defines,
			standard,
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
				uri: vscode.Uri.file(filePath).toString(),
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

	LogConfigurationProvider() {
		logger.Message("Sending Workspace Browse Configuration: -----------------------------------");
		logger.Message("Browse Path: " + this.workspaceBrowseConfiguration.browsePath.join(";"));
		logger.Message("Standard: " + this.workspaceBrowseConfiguration.standard);
		logger.Message("Compiler Path: " + this.workspaceBrowseConfiguration.compilerPath);
		if (process.platform === "win32") {
			logger.Message("Windows SDK Version: " + this.workspaceBrowseConfiguration.windowsSdkVersion);
		}
		logger.Message("-----------------------------------");

		this.fileIndex.forEach(filePath => {
			logger.Message("Sending configuration for file " + filePath.uri.toString() + "-----------------------------------");
			logger.Message("Defines: " + filePath.configuration.defines.join(";"));
			logger.Message("Includes: " + filePath.configuration.includePath.join(";"));
			if (filePath.configuration.forcedInclude) {
				logger.Message("Force Includes: " + filePath.configuration.forcedInclude.join(";"));
			}
			logger.Message("Standard: " + filePath.configuration.standard);
			logger.Message("IntelliSense Mode: " + filePath.configuration.intelliSenseMode);
			logger.Message("Compiler Path: " + filePath.configuration.compilerPath);
			if (process.platform === "win32") {
				logger.Message("Windows SDK Version: " + filePath.configuration.windowsSdkVersion);
			}
			logger.Message("-----------------------------------");
		});
	}
}


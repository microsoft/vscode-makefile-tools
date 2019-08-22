import * as child_process from 'child_process';
import * as configuration from './configuration';
import * as ext from './extension';
import * as logger from './logger';
import * as util from './util';
import * as vscode from 'vscode';

export async function buildCurrentTarget() {
	let process: child_process.ChildProcess;

	let commandArgs: string[] = [];
	// Prepend the target to the arguments given in the configurations json.
	let currentTarget = configuration.getCurrentTarget();
	if (currentTarget) {
		commandArgs.push(currentTarget);
	}
	
	commandArgs = commandArgs.concat(configuration.getConfigurationCommandArgs());

	logger.Message("Building the current target ... Command: " + configuration.getConfigurationCommandName() + " " + commandArgs.join(" "));

	try {
		// Append without end of line since there is one already included in the stdout/stderr fragments
		var stdout = (result: string): void => {
			logger.MessageNoCR(result);
		};

		var stderr = (result: string): void => {
			logger.MessageNoCR(result);
		};

		var closing = (retCode: number, signal: string): void => {
			if (retCode !== 0) {
				logger.Message("The current target failed to build.");
			} else {
				logger.Message("The current target built successfully.");
			}
		};

		await util.spawnChildProcess(configuration.getConfigurationCommandName(), commandArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
	} catch (error) {
		logger.Message('Failed to launch make command. Make sure it is on the path. ' + error);
		return;
	}
}

export async function DryRun() {
	let process: child_process.ChildProcess;

	let commandArgs: string[] = [];

	// Prepend the target to the arguments given in the configurations json.
	let currentTarget = configuration.getCurrentTarget();
	if (currentTarget) {
		commandArgs.push(currentTarget);
	}

	// Append --dry-run (to not perform any real build operation),
	// --always-make (to not skip over targets when timestamps indicate nothing needs to be done)
	// and --keep-going (to ensure we get as much info as possible even when some targets fail)
	commandArgs = commandArgs.concat(configuration.getConfigurationCommandArgs());
	commandArgs.push("--dry-run");
	commandArgs.push("--always-make");
	commandArgs.push("--keep-going");

	logger.Message("Generating the make dry-run output for parsing IntelliSense information... Command: " +
    configuration.getConfigurationCommandName() + " " + commandArgs.join(" "));

	try {
		let stdoutStr: string = "";
		let stderrStr: string = "";

		var stdout = (result: string): void => {
			stdoutStr += result;
		};
		var stderr = (result: string): void => {
			stderrStr += result;
		};
		var closing = (retCode: number, signal: string): void => {
			if (retCode !== 0) {
				logger.Message("The make dry-run command failed.");
				logger.Message(stderrStr);
			}

			console.log("Make dry-run output to parse is:\n" + stdoutStr);
			ext.UpdateProvider(stdoutStr);
		};

		await util.spawnChildProcess(configuration.getConfigurationCommandName(), commandArgs, vscode.workspace.rootPath || "", stdout, stderr, closing);
	} catch (error) {
		logger.Message('Failed to launch make command. Make sure it is on the path. ' + error);
		return;
	}
}


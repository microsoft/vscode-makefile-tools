// TODO: support also the scenario of parsing a build log,
// to overcome some of --dry-run limitations
// (like some exceptions to the 'do not execute' rule
// or dependencies on a real build)

import * as cpptools from './cpptools';
import * as ext from './extension';
import * as logger from './logger';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import { LaunchConfiguration } from './configuration';

export function parseTargets(verboseLog: string): string[] {
	// extract the text between "# Files" and "# Finished Make data base" lines
	let regexp = /(# Files\n*)([\s\S]*?)(# Finished Make data base)/;
	let result: string[] | null = verboseLog.match(regexp);
	if (result) {
		verboseLog = result[2];
	}

	var matches: string[] = [];
	var match: string[] | null;

	// skip lines starting with {#,.} or preceeded by "# Not a target" and extract the target
	regexp = /^(?!\n?[#\.])(?<!^\n?# Not a target:\s*)\s*(\S+):\s+/mg;
	while (match = regexp.exec(verboseLog)) {
		matches.push(match[1]);
	}

	if (matches) {
		matches.sort();
		logger.message("Found the following targets:" + matches.join(";"));
	} else {
		logger.message("No targets found");
	}

	return matches;
}

// Make various preprocessing transformations on the dry-run output
// TODO: "cmd -c", "start cmd", "exit"
function preprocessDryRunOutput(dryRunOutputStr: string): string {
	let preprocessedDryRunOutputStr: string = dryRunOutputStr;

	// Split multiple commands concatenated by '&&'
	preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/ && /g, "\n"); // \r

	// Extract the link command 
	// Keep the /link switch to the cl command because otherwise we will see compiling without /c
	// and we will deduce some other output binary based on its /Fe or /Fo or first source given,
	// instead of the output binary defined via the link operation (which will be parsed on the next line).
	// TODO: address more accurately the overriding scenarios between output files defined via cl.exe
	// and output files defined via cl.exe /link.
	// For example, "cl.exe source.cpp /Fetest.exe /link /debug" still produces test.exe
	// but cl.exe source.cpp /Fetest.exe /link /out:test2.exe produces only test2.exe.
	// For now, ignore any output binary rules of cl while having the /link switch.
	if (process.platform === "win32") {
		preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/ \/link /g, "/link \n link.exe "); // \r
	}

	// TODO: Insert preprocessed files content

	// TODO: Wrappers (example: cl.cmd)

	return preprocessedDryRunOutputStr;
}
interface ToolInvocation {
	// how the makefile invokes the tool:
	// relative path, full path, explicit current directory or no path
	// also including the file name, with or without extension
	pathInMakefile: string;

	// a full path formed from the given current path and the path in makefile
	// plus the file name, with the extension appended (for windows)
	fullPath: string;

	// if found at the full path resolved above
	found: boolean;

	// the arguments passed to the tool invocation
	// define as string so that we deal with the separator properly later, via RegExp
	arguments: string;
}

// Helper that parses the given line as a tool invocation.
// The full path that is returned is calculated with the following logic:
//     - make a full path out of the one given in the makefile 
//       and the current path that is calculated as of now
//     - if the tool is not found at the full path above and if requested,
//       it will be searched in all the paths of the PATH environment variable
//       and the first one found will be returned
// TODO: handle the following corner cases:
//     - quotes only around directory (file name outside quotes)
//     - path containing "toolName(no extension) " in the middle
function parseLineAsTool(
	line: string,
	toolNames: string[],
	currentPath: string
): ToolInvocation | undefined {
	// - any spaces/tabs before the tool invocation
	// - with or without path (relative or full)
	// - with or without extension (windows only)
	// - with or without quotes
	// - must have at least one space or tab after the tool invocation
	let regexpStr: string = '^[\\s\\"]*(.*?)(';
	if (process.platform === "win32") {
		regexpStr += toolNames.join('\\.exe|');

		// make sure to append extension if the array of tools has only one element,
		// in which case .join is not doing anything
		if (toolNames.length == 1) {
			regexpStr += ('\\.exe');
		}
	}
	regexpStr += '|' + toolNames.join('|') + ')[\\s\\"]+(.*)$';

	let regexp: RegExp = RegExp(regexpStr, "mg");
	let match = regexp.exec(line);

	if (!match) {
		return undefined;
	}

	let toolPathInMakefile: string = match[1];
	let toolNameInMakefile: string = match[2];
	if (process.platform === "win32" && !path.extname(toolNameInMakefile)) {
		toolNameInMakefile += ".exe";
	}
	toolPathInMakefile = toolPathInMakefile.trimLeft();
	let toolFullPath: string = util.makeFullPath(toolPathInMakefile + toolNameInMakefile, currentPath);
	toolFullPath = util.removeQuotes(toolFullPath);
	let toolFound: boolean = util.checkFileExistsSync(toolFullPath);

	// Reject a regexp match that doesn't have a real path before the tool invocation,
	// like for example link.exe /out:cl.exe being mistakenly parsed as a compiler command.
	// Basically, only spaces and/or tabs and/or a valid path are allowed before the compiler name.
	// There is no other easy way to eliminate that case via the regexp
	// (it must accept a string before the tool).
	// For now, we consider a path as valid if it can be found on disk.
	// TODO: be able to recognize a string as a valid path even if it doesn't exist on disk,
	// in case the project has a setup phase that is copying/installing stuff (like the toolset)
	// and it does not have yet a build in place, therefore a path or file is not yet found on disk,
	// even if it is valid.
	// In other words, we allow the tool to not be found only if the makefile invokes it without any path,
	// which opens the possibility of searching the tool through all the paths in the PATH environment variable.
	// Note: when searching for execution targets in the makefile, if a binary was not previously built,
	// the extension will not detect it for a launch configuration because of this following return.
	if (toolPathInMakefile !== "" && !toolFound) {
		return undefined;
	}

	return {
		pathInMakefile: toolPathInMakefile,
		fullPath: toolFullPath,
		arguments: match[3],
		found: toolFound
	};
}

// Helper that parses for a particular switch that can occur one or more times
// in the tool command line (example -I or -D for compiler)
// and returns an array of the values passed via that switch
function parseMultipleSwitchFromToolArguments(args: string, sw: string): string[] {
	// - or / as switch prefix
	// one or none or more spaces/tabs between the switch and the value
	let regexpStr = '(\\/' + sw + '\\s*|-' + sw + '\\s*)(\\".*?\\"|\\S+)';
	let regexp = RegExp(regexpStr, "mg");
	var match: string[] | null;
	var results: string[] = [];

	while (match = regexp.exec(args)) {
		let result: string = match[2].trim();
		result = result.replace(/"/g, "");
		results.push(result);
	}

	return results;
}

// Helper that parses for a particular switch that can occur once in the tool command line,
// or if it is allowed to be specified more than once, the latter would override the former.
// The switch is an array of strings (as opposed to a simple string)
// representing all the alternative switches in distinct toolsets (cl, versus gcc, versus clang, etc)
// of the same conceptual argument of the given tool.
// The helper returns the value passed via the given switch
// Examples for compiler: -std:c++17, -Fotest.obj, -Fe test.exe
// Example for linker: -out:test.exe versus -o a.out
function parseSingleSwitchFromToolArguments(args: string, sw: string[]): string | undefined {
	// - or / as switch prefix
	// ':' or '=' or one/none/more spaces/tabs between the switch and the value
	let regexpStr = '(\\/|-)(' + sw.join("|") + ')(:|=|\\s*)(\\".*?\\"|\\S+)';
	let regexp = RegExp(regexpStr, "mg");
	var match: string[] | null;
	var results: string[] = [];

	while (match = regexp.exec(args)) {
		let result: string = match[4].trim();
		result = result.replace(/"/g, "");
		results.push(result);
	}

	return results.pop();
}

// Helper that answers whether a particular switch is passed to the tool.
// When calling this helper, we are not interested in obtaining the
// (or there is no) value passed in via the switch. 
// There must be at least one space/tab before the switch,
// so that we don't match a path by mistake.
// Same after the switch, in case the given name is a substring
// of another switch name. Or have the switch be the last in the command line.
// Examples: we call this helper for /c compiler switch or /dll linker switch.
// TODO: detect sets of switches that cancel each other to return a more
// accurate result in case of override (example: /TC and /TP)
function isSwitchPassedInArguments(args: string, sw: string[]) : boolean {
	// - or / as switch prefix
	// - one or more spaces/tabs after
	let regexpStr = '(\\s*)(\\/|-)(' + sw.join("|") + ')(\\s+|$)';
	let regexp = RegExp(regexpStr, "mg");
	var match: string[] | null;

	if (match = regexp.exec(args)) {
		return true;
	}

	return false;
}

// Helper that parses for files (of given extensions) that are given as arguments to a tool
// TODO: consider non standard extensions (or no extension at all) in the presence of TC/TP.
// Attention to obj, pdb or exe files tied to /Fo, /Fd and /Fe
function parseFilesFromToolArguments(args: string, exts: string[]): string[] {
	// no switch prefix and no association yet with a preceding switch
	// one or more spaces/tabs before and after
	// with or without quotes surrounding the argument
	// (todo: handle the scenario when quotes enclose just the directory path, without the file name)
	let regexpStr = '(';
	exts.forEach(ext => {
		regexpStr += '\\".*?\\.' + ext + '\\"|';
		regexpStr += '\\S+\\.' + ext;
		// Make sure we don't append '|' after the last extension value
		if (ext !== exts[exts.length - 1]) {
			regexpStr += '|';
		}
	});
	regexpStr += ')';

	let regexp = RegExp(regexpStr, "mg");
	var match: string[] | null;
	var files: string[] = [];

	while (match = regexp.exec(args)) {
		let result: string = match[1].trim();
		result = result.replace(/"/g, "");
		files.push(result);
	}

	return files;
}

// Helper that identifies system commands (cd, cd -, pushd, popd) and make.exe change directory switch
// to calculate the effect on the current path, also remembering the transition in the history stack.
// The current path is always the last one into the history
function currentPathAfterCommand(line : string, currentPathHistory : string[]) : string[] {
	line = line.trimLeft();
	let currentPath : string = currentPathHistory[currentPathHistory.length - 1];
	if (line.startsWith('cd -')) {
		currentPathHistory.pop();
		let lastPath : string = currentPathHistory[currentPathHistory.length - 1];
		currentPathHistory.push(currentPath);
		currentPathHistory.push(lastPath);
	} else if (line.startsWith('popd') || line.includes('Leaving directory')) {
		currentPathHistory.pop();
	} else if (line.startsWith('cd')) {
		currentPath = line.slice(3);
		currentPathHistory.pop();
		currentPathHistory.push(currentPath);
	} else if (line.startsWith('pushd')) {
		currentPath = line.slice(6);
		currentPathHistory.push(currentPath);
	} else if (line.includes('Entering directory')) {
		// equivalent to pushd
		let match = line.match("(.*)(Entering directory ')(.*)'");
		if (match) {
			currentPath = match[3] || "";
		} else {
			currentPath = "Could not parse directory";
		}
		currentPathHistory.push(currentPath);
	}

	return currentPathHistory;
}

// Parse the output of the make dry-run command in order to provide CppTools
// with information about includes, defines, compiler path....etc... 
// as needed by CustomConfigurationProvider
export function parseForCppToolsCustomConfigProvider(dryRunOutputStr: string) {
	logger.message('Parsing dry-run output for CppTools Custom Configuration Provider...');

	// Do some preprocessing on the dry-run output to make the RegExp parsing easier
	dryRunOutputStr = preprocessDryRunOutput(dryRunOutputStr);

	// Empty the cummulative browse path built during the previous dry-run parsing
	cpptools.clearCummulativeBrowsePath();

	// Current path starts with workspace root and can be modified
	// with prompt commands like cd, cd-, pushd/popd or with -C make switch
	let currentPath: string = vscode.workspace.rootPath || "";
	let currentPathHistory: string[] = [currentPath];

	// Read the dry-run output line by line, searching for compilers and directory changing commands
	// to construct information for the CppTools custom configuration
	let dryRunOutputLines: string[] = dryRunOutputStr.split("\n"); // \r
	dryRunOutputLines.forEach(line => {
		logger.message(line);
		currentPathHistory = currentPathAfterCommand(line, currentPathHistory);
		currentPath = currentPathHistory[currentPathHistory.length - 1];

		// List of compiler tools plus the most common aliases cc and c++
		// ++ needs to be escaped for the regular expression in parseLineAsTool.
		// todo: any other scenarios of aliases and symlinks
		// that would make parseLineAsTool to not match the regular expression,
		// therefore wrongly skipping over this compilation line?
		const compilers: string[] = ["clang", "cl", "gcc", "cc", "icc", "icl", "g\\+\\+", "c\\+\\+"];
		let compilerTool : ToolInvocation | undefined = parseLineAsTool(line, compilers, currentPath);
		if (compilerTool) {
			// Compiler path is either what the makefile provides or found in the PATH environment variable or empty
			let compilerFullPath = compilerTool.fullPath || "";
			if (!compilerTool.found) {
				compilerFullPath = util.toolPathInEnv(path.basename(compilerFullPath)) || "";
			}
			logger.message("Compiler path: " + compilerFullPath);

			// Parse and log the includes, forced includes and the defines
			let includes : string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'I');
			includes = util.makeFullPaths(includes, currentPath);
			logger.message("Includes: " + includes);
			let forcedIncludes : string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'FI');
			forcedIncludes = util.makeFullPaths(forcedIncludes, currentPath);
			logger.message("Forced includes: " + forcedIncludes);
			let defines : string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'D');
			logger.message("Defines: " + defines);

			// Parse the C/C++ standard
			// TODO: implement default standard: c++11 for C nad c++17 for C++
			// TODO: c++20 and c++latest
			let standardStr: string | undefined = parseSingleSwitchFromToolArguments(compilerTool.arguments, ["std"]);
			let standard: util.StandardVersion = standardStr ? <util.StandardVersion>standardStr : "c++17";
			logger.message("Standard: " + standard);

			// Parse the IntelliSense mode
			// how to deal with aliases and symlinks (CC, C++), which can point to any toolsets
			var intelliSenseMode: util.IntelliSenseMode = "msvc-x64";
			if (path.basename(compilerTool.fullPath).startsWith("clang")) {
				intelliSenseMode = "clang-x64";
			} else if (path.basename(compilerTool.fullPath).startsWith("gcc") ||
				path.basename(compilerTool.fullPath).startsWith("g++")) {
				intelliSenseMode = "gcc-x64";
			}
			logger.message("IntelliSense mode: " + intelliSenseMode);

			// For windows, parse the sdk version
			// todo: scan on disk for most recent sdk installation
			var windowsSDKVersion: string | undefined = "";
			if (process.platform === "win32") {
				windowsSDKVersion = process.env["WindowsSDKVersion"];
				if (!windowsSDKVersion) {
					windowsSDKVersion = "8.1";
				}

				logger.message('Windows SDK Version: ' + windowsSDKVersion);
			}

			// Parse the source files
			let files: string[] = parseFilesFromToolArguments(compilerTool.arguments, ["cpp", "c", "cxx"]);
			files = util.makeFullPaths(files, currentPath);
			logger.message("Source files: " + files.join(" "));

			if (ext.extension) {
				ext.extension.buildCustomConfigurationProvider(defines, includes, forcedIncludes, standard, intelliSenseMode, compilerFullPath, windowsSDKVersion, files);
			}
		}
	});
}

// Parse the output of the make dry-run command in order to provide VS Code debugger
// with information about binaries, their execution paths and arguments
export function parseForLaunchConfiguration(dryRunOutputStr: string) : LaunchConfiguration[] {
	logger.message('Parsing dry-run output for Launch (debug/run) configuration...');

	// Do some preprocessing on the dry-run output to make the RegExp parsing easier
	dryRunOutputStr = preprocessDryRunOutput(dryRunOutputStr);

	// Current path starts with workspace root and can be modified
	// with prompt commands like cd, cd-, pushd/popd or with -C make switch
	let currentPath: string = vscode.workspace.rootPath || "";
	let currentPathHistory: string[] = [currentPath];

	// array of full path executables built by this makefile
	let targetBinaries : string[] = [];
	// array of launch configurations, for each of the binaries above
	let launchConfigurations : LaunchConfiguration[] = [];

	// The first pass of reading the dry-run output, line by line
	// searching for compilers, linkers and directory changing commands
	// to construct information for the launch configuration
	let dryRunOutputLines: string[] = dryRunOutputStr.split("\n"); // \r
	dryRunOutputLines.forEach(line => {
		logger.message(line);
		currentPathHistory = currentPathAfterCommand(line, currentPathHistory);
		currentPath = currentPathHistory[currentPathHistory.length - 1];

		// A target binary is usually produced by the linker with the /out or /o switch
		// but there are several scenarios of compiler producing an output binary directly
		let compilerTargetBinary : string | undefined;
		let linkerTargetBinary : string | undefined;

		// List of compiler tools plus the most common aliases cc and c++
		// ++ needs to be escaped for the regular expression in parseLineAsTool.
		// todo: any other scenarios of aliases and symlinks
		// that would make parseLineAsTool to not match the regular expression,
		// therefore wrongly skipping over this compilation line?
		const compilers: string[] = ["clang", "cl", "gcc", "cc", "icc", "icl", "g\\+\\+", "c\\+\\+"];
		let compilerTool: ToolInvocation | undefined = parseLineAsTool(line, compilers, currentPath);
		if (compilerTool) {
			// Parse the source files
			let files: string[] = parseFilesFromToolArguments(compilerTool.arguments, ["cpp", "c", "cxx"]);
			files = util.makeFullPaths(files, currentPath);
			logger.message("Source files to be compiled: " + files.join(" "));

			// If a cl.exe is not performing only an obj compilation, deduce the output executable if possible
			// Note: no need to worry about the DLL case that this extension doesn't support yet
			// since a compiler can produce implicitly only an executable.
			if (process.platform === "win32" && path.basename(compilerTool.fullPath).startsWith("cl")) {
				if (!isSwitchPassedInArguments(compilerTool.arguments, ["c"])) {
					// First read the value of the /Fe switch (for cl.exe) or -o for compilers on linux/mac
					compilerTargetBinary = parseSingleSwitchFromToolArguments(compilerTool.arguments, ["Fe", "o"]);

					// Then assume first object file base name (defined with /Fo) + exe
					// Note: /Fo is not allowed on multiple sources compilations so there will be only one if found
					if (!compilerTargetBinary) {
						let objFile: string | undefined = parseSingleSwitchFromToolArguments(compilerTool.arguments, ["Fo"]);
						if (objFile) {
							let parsedObjPath: path.ParsedPath = path.parse(objFile);
							compilerTargetBinary = parsedObjPath.dir + parsedObjPath.name + ".exe";
						}
					}

					// Then assume first source file base name + exe.
					if (!compilerTargetBinary) {
						let srcFiles: string[] | undefined = parseFilesFromToolArguments(compilerTool.arguments, ["cpp", "c", "cxx"]);
						if (srcFiles.length >= 1) {
							let parsedSourcePath: path.ParsedPath = path.parse(srcFiles[0]);
							compilerTargetBinary = parsedSourcePath.dir + path.sep + parsedSourcePath.name + ".exe";
						}
					}
				}
			}

			if (compilerTargetBinary) {
				compilerTargetBinary = util.makeFullPath(compilerTargetBinary, currentPath);
			}
		}

		const linkers: string[] = ["link", "ilink", "ld", "gcc", "clang", "cc", "g\\+\\+", "c\\+\\+"]; // any aliases/symlinks ?
		let linkerTool: ToolInvocation | undefined = parseLineAsTool(line, linkers, currentPath);
		if (linkerTool) {
			// TODO: support launch of DLLs/libs besides launching of executables
			if (!isSwitchPassedInArguments(linkerTool.arguments, ["dll", "lib", "shared"])) {
				// Gcc/Clang tools can also perform linking so don't parse any output binary if -c is given
				// (-o will point to an object file and not a binary)
				if (!isSwitchPassedInArguments(linkerTool.arguments, ["c"])) {
					linkerTargetBinary = parseSingleSwitchFromToolArguments(linkerTool.arguments, ["out", "o"]);

					if (!linkerTargetBinary) {
						logger.message("The link command is not generating a target binary explicitly.");
						// For link.exe, the default output binary takes the base name of the first file (obj, lib, etc...)
						// that is passed to the linker.
						if (process.platform === "win32" && path.basename(linkerTool.fullPath).startsWith("link")) {
							// TODO: investigate whether we need to look also at other files with different extensions than .obj/.lib
							let files: string[] = parseFilesFromToolArguments(linkerTool.arguments, ["obj", "lib"]);
							if (files.length >= 1) {
								let parsedPath: path.ParsedPath = path.parse(files[0]);
								let targetBinaryFromFirstObjLib: string = parsedPath.dir + parsedPath.name + ".exe";
								logger.message("Assuming " + targetBinaryFromFirstObjLib)
								linkerTargetBinary = targetBinaryFromFirstObjLib;
							}
						} else {
							// The default output binary from a compilation/linking operation is usually a.out on linux/mac
							logger.message("Assuming a.out");
							linkerTargetBinary = "a.out";
						}
					}
				}

				if (linkerTargetBinary) {
					linkerTargetBinary = util.makeFullPath(linkerTargetBinary, currentPath);
				}
			}
		}

		// It is not possible to have compilerTargetBinary and linkerTargetBinary both defined,
		// because a dry-run output line cannot be a compilation and an explicit link at the same time.
		// (cl.exe with /link switch is split into two lines - cl.exe and link.exe - during dry-run preprocessing).
		// Also for gcc/clang, -o switch or the default output will be a .o in the presenece of -c and an executable otherwise.
		let targetBinary: string | undefined = linkerTargetBinary || compilerTargetBinary;
		if (targetBinary) {
			targetBinaries.push(targetBinary);

			// Include limited launch configuration, when only the binary is known,
			// in which case the execution path is defaulting to workspace root folder
			// and there are no args.
			launchConfigurations.push({
				binary : targetBinary,
				cwd : vscode.workspace.rootPath || "",
				args : []
			});
		}
	});

	// For each of the built binaries identified in the dry-run pass above,
	// search the makefile for possible targets that are invoking them,
	// to update the launch configuration with their name, full path, execution path and args.
	// If a built binary is not having an execution target defined in the makefile,
	// the launch configuration will be limited to the version having only with their name and path,
	// workspace folder instead of another execution path and zero args.
	// If this is not sufficient, the user can at any time write an execution target
	// in the makefile or write a launch configuration in the settings json.

	// TODO: investigate the scenario when the binary is run relying on path environment variable
	// and attention to on the fly environment changes made by make.

	// Reset the current path since we are going to analyze path transitions again
	// with this second pass through the dry-run output lines,
	// while building the launch custom provider data.
	currentPath = vscode.workspace.rootPath || "";
	currentPathHistory = [currentPath];

	// Make also an array with only the base file names of the found target binaries.
	let targetBinariesNames : string[] = [];
	targetBinaries.forEach(target => {
		let parsedPath : path.ParsedPath = path.parse(target);
		if (!targetBinariesNames.includes(parsedPath.name)) {
			targetBinariesNames.push(parsedPath.name);
		}
	});

	dryRunOutputLines.forEach(line => {
		currentPathHistory = currentPathAfterCommand(line, currentPathHistory);
		currentPath = currentPathHistory[currentPathHistory.length - 1];

		// Currently, the target binary invocation will not be identified if the line does not start with it,
		// because we need to be able to reject matches like "link.exe /out:mybinary.exe".
		// See comment in parseLineAsTool about not understanding well what it is that prepends
		// the target binary tool, unless we treat it as a path and verify its location on disk.
		// Because of this limitation, the extension might not present to the user
		// all the scenarios of arguments defined in the makefile for this target binary.
		// TODO: identify and parse properly all the valid scenarios of invoking a taget binary in a makefile:
		//       - @if (not) exist binary binary arg1 arg2 arg3
		//         (because an "@if exist" is not resolved by the dry-run and appears in the output)
		//       - cmd /c binary arg1 arg2 arg3
		//       - start binary
		let targetBinaryTool : ToolInvocation | undefined = parseLineAsTool(line, targetBinariesNames, currentPath);
		if (targetBinaryTool) {
			// Include complete launch configuration: binary, execution path and args
			// are known from parsing the dry-run
			let splitArgs : string[] = targetBinaryTool.arguments.split(" ");
			launchConfigurations.push({
				binary : targetBinaryTool.fullPath,
				cwd : currentPath,
				// TODO: consider optionally quoted arguments
				args : splitArgs
			});
		}
	});

	return launchConfigurations;
}

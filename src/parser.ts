import * as cpptools from './cpptools';
import * as ext from './extension';
import * as logger from './logger';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';

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
		logger.Message("Found the following targets:" + matches.join(";"));
	} else {
		logger.Message("No targets found");
	}

	return matches;
}

// TODO: 
//     - account for changes of directory when resolving relative paths
//     - support for response files (@) and compiler wrappers (example: cl.cmd)
export async function parseDryRunOutput(dryRunOutputStr: string) {
	// Empty the cummulative browse path built with the previous dry-run parsing
	cpptools.emptyCummulativeBrowsePath();

	// {space} | compiler w/o path, w/o .exe, w/o quotes | switches - or / | files
	// Compilers: cl, clang, clang++, gcc, g++, icc, icl
	// Include also the most common aliases cc and c++
	// todo: any other scenarios of aliases and symlinks
	// that would make this parsing helper to skip over compilation lines?

	// find lines containing compilers
	// todo: fix bug with a path containing "cl " in the middle
	let regexp = /^[\s\"]*(.*?)(clang|cl\.exe|cl|gcc|cc|icc|icl|g\+\+|c\+\+)[\s\"]*(.*)$/mg;
	var matches: string[] = [];
	var match: string[] | null;

	logger.Message('Parsing dry-run output ...');

	// Current path starts with workspace root path and can be modified
	// with prompt commands like cd, cd-, pushd/popd or with -C make switch
	// todo: implement the current path updates to provide correct information
	// to IntelliSense in such scenarios
	let currentPath: string = vscode.workspace.rootPath || "";

	while (match = regexp.exec(dryRunOutputStr)) {
		logger.Message('Full line: ' + match[0]);

		let compilerPathInMakefile: string = match[1];
		let compilerNameInMakefile: string = match[2];

		if (process.platform === "win32" && !path.extname(compilerNameInMakefile)) {
			compilerNameInMakefile += ".exe";
		}

		let compilerFullPath: string = compilerPathInMakefile + compilerNameInMakefile;

		// find out full compiler path if missing or partial
		if (!util.checkFileExistsSync(compilerFullPath)) {
			logger.Message(compilerFullPath + ' does not exist. Searching through the paths in the PATH environment variable...');

			let envPath: string | undefined = process.env["PATH"];
			let envPathSplit: string[] = [];
			if (envPath) {
				envPathSplit = envPath.split(path.delimiter);
			}

			envPathSplit.forEach(p => {
				let fullPath: string = path.join(p, path.basename(compilerFullPath));
				if (util.checkFileExistsSync(fullPath)) {
					logger.Message("Found compiler path " + fullPath);
					compilerFullPath = fullPath;
					return;
				}
			});

			// todo: if the compiler is not found in path, scan on disk and point the user to all the options
			// (the concept of kit for cmake extension)
		}

		// Parse the includes from a compilation line
		let regexp_inc = /(\/I\s*|-I\s*)(\".*?\"|\S+)/mg;
		var match_inc: string[] | null;
		var includes: string[] = [];

		while (match_inc = regexp_inc.exec(match[3])) {
			let result_inc: string = match_inc[2].trim();
			result_inc = result_inc.replace(/"/g, "");
			includes.push(util.makeFullPath(result_inc, currentPath));
		}

		logger.Message('Includes:' + includes.join(";"));

		// Parse the forced includes from a compilation line
		let regexp_finc = /(\/FI\s*|-FI\s*)(\".*?\"|\S+)/mg;
		var match_finc: string[] | null;
		var forced_includes: string[] = [];

		while (match_finc = regexp_finc.exec(match[3])) {
			let result_finc: string = match_finc[2].trim();
			result_finc = result_finc.replace(/"/g, "");
			includes.push(util.makeFullPath(result_finc, currentPath));
		}

		logger.Message('Forced includes:' + forced_includes.join(";"));

		// Parse the defines from a compilation line
		let regexp_def = /(\/D\s*|-D\s*)(\".*?\"|\S+)/mg;
		var match_def: string[] | null;
		var defines: string[] = [];

		while (match_def = regexp_def.exec(match[3])) {
			let result_def: string = match_def[2].trim();
			result_def = result_def.replace(/"/g, "");
			defines.push(result_def);
		}

		logger.Message('Defines:' + defines.join(";"));

		// Parse the C/C++ standard
		let regexp_std = /(\/|-)std(:|=)(\S+)/mg;
		var match_std: string[] | null;
		var stds: string[] = [];

		while (match_std = regexp_std.exec(match[3])) {
			let result_std: string = match_std[3].trim();
			result_std = result_std.replace(/"/g, "");
			stds.push(result_std);
		}

		// todo: 
		//     - implement standard defaults (c++11 for .c, c++17 for .cpp)
		//     - account for /TC and /TP
		let lastStd: util.StandardVersion;
		if (stds.length) {
			// If more than one std switch, take the last one
			lastStd = <util.StandardVersion>stds.pop();
		} else {
			lastStd = "c++17";
		}

		logger.Message('Standard:' + lastStd);

		// Parse IntelliSense mode
		// how to deal with aliases and symlinks (CC, C++), which can point to any toolsets
		var intelliSenseMode: util.IntelliSenseMode = "msvc-x64";
		if (compilerNameInMakefile.startsWith("clang")) {
			intelliSenseMode = "clang-x64";
		} else if (compilerNameInMakefile.startsWith("gcc") || compilerNameInMakefile.startsWith("g++")) {
			intelliSenseMode = "gcc-x64";
		}

		// Parse the source files that are compiled
		// todo: consider non standard extensions (or no extension at all) in the presence of TC/TP.
		// Attention to obj or pdb files tied to /FO /FD
		let regexp_files = /(\".*?\.cpp\"|\S+\.cpp|\".*?\.c\"|\S+\.c|\".*?\.cxx\"|\S+\.cxx)/mg;
		var match_file: string[] | null;
		var files: string[] = [];

		while (match_file = regexp_files.exec(match[3])) {
			let result_file: string = match_file[1].trim();
			result_file = result_file.replace(/"/g, "");
			files.push(util.makeFullPath(result_file, currentPath));
		}

		logger.Message('Files:' + files.join(";"));

		// todo: scan on disk for most recent sdk installation
		var windowsSDKVersion: string | undefined = "";
		if (process.platform === "win32") {
			windowsSDKVersion = process.env["WindowsSDKVersion"];
			if (!windowsSDKVersion) {
				windowsSDKVersion = "8.1";
			}

			logger.Message('Windows SDK Version: ' + windowsSDKVersion);
		}

		if (ext.extension) {
			ext.extension.buildCustomConfigurationProvider(defines, includes, forced_includes, lastStd, intelliSenseMode, compilerFullPath, windowsSDKVersion, files);
		}
	}
}

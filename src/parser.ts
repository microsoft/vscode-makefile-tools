// TODO: support also the scenario of parsing a build log,
// to overcome some of --dry-run limitations
// (like some exceptions to the 'do not execute' rule
// or dependencies on a real build)

import * as configuration from './configuration';
import * as cpp from 'vscode-cpptools';
import * as cpptools from './cpptools';
import * as ext from './extension';
import * as logger from './logger';
import * as make from './make';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import { setTimeout } from 'timers';

// List of compiler tools plus the most common aliases cc and c++
// ++ needs to be escaped for the regular expression in parseLineAsTool.
// todo: any other scenarios of aliases and symlinks
// that would make parseLineAsTool to not match the regular expression,
// therefore wrongly skipping over compilation lines?
const compilers: string[] = ["clang\\+\\+", "clang", "cl", "gcc", "cc", "icc", "icl", "g\\+\\+", "c\\+\\+"];
const linkers: string[] = ["link", "ilink", "ld", "gcc", "clang\\+\\+", "clang", "cc", "g\\+\\+", "c\\+\\+"];
const sourceFileExtensions: string[] = ["cpp", "cc", "cxx", "c"];

const chunkSize: number = 100;

async function scheduleTask(task: (taskEndCallback: () => void) => Promise<void>): Promise<void> {
    return new Promise<void>(resolve => {
        let onEnd: any = (): void => {
            resolve();
        };

        setImmediate(() => {
            task(onEnd);
        });
    });
}
export async function parseTargets(cancel: vscode.CancellationToken, verboseLog: string,
                                   statusCallback: (message: string) => void,
                                   foundTargetCallback: (target: string) => void,
                                   endCallback: (retc: number) => void): Promise<number> {
    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

    cancel.onCancellationRequested(() => {
        endCallback(make.ConfigureBuildReturnCodeTypes.cancelled);
    });

    return new Promise<number>(async function (resolve, reject): Promise<void> {
        // Extract the text between "# Files" and "# Finished Make data base" lines
        // There can be more than one matching section.
        let regexpExtract: RegExp = /(# Files\n*)([\s\S]*?)(# Finished Make data base)/mg;
        let result: RegExpExecArray | null;
        let extractedLog: string = "";

        let matches: string[] = [];
        let match: string[] | null;
        result = regexpExtract.exec(verboseLog);

        while (result) {
            extractedLog = result[2];

            // skip lines starting with {#,.} or preceeded by "# Not a target" and extract the target
            let regexpTarget: RegExp = /^(?!\n?[#\.])(?<!^\n?# Not a target:\s*)\s*(\S+):\s+/mg;

            match = regexpTarget.exec(extractedLog);

            if (match) {
                await scheduleTask(async (taskEndCallback: () => void) => {
                    function doChunk(): void {
                        let chunkIndex: number = 0;

                        while (match && chunkIndex <= chunkSize) {
                            if (cancel.isCancellationRequested) {
                                break;
                            }

                            // Make sure we don't insert duplicates.
                            // They can be caused by the makefile syntax of defining variables for a target.
                            // That creates multiple lines with the same target name followed by :,
                            // which is the pattern parsed here.
                            if (!matches.includes(match[1])) {
                                matches.push(match[1]);
                                foundTargetCallback(match[1]);
                            }

                            statusCallback("Parsing build targets...");
                            match = regexpTarget.exec(extractedLog);

                            if (!match) {
                                resolve();
                            }

                            chunkIndex++;
                            if (chunkIndex === chunkSize) {
                                setTimeout(doChunk, 0);
                            }
                        } // while match

                        taskEndCallback();
                    } // doChunk function

                    doChunk();
                }); // scheduleTask
            }// if match

            result = regexpExtract.exec(verboseLog);
        } // while result

        resolve(make.ConfigureBuildReturnCodeTypes.success);
        endCallback(make.ConfigureBuildReturnCodeTypes.success);
    }); // return promise
}

// Make various preprocessing transformations on the dry-run output
// TODO: "cmd -c", "start cmd", "exit"
export async function preprocessDryRunOutput(cancel: vscode.CancellationToken, dryRunOutputStr: string,
                                             statusCallback: (message: string) => void,
                                             endCallback: (retc: number, preprocessedDryRunOutput: string | null) => void): Promise<number> {
    let preprocessedDryRunOutputStr: string = dryRunOutputStr;

    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

    cancel.onCancellationRequested(() => {
        endCallback(make.ConfigureBuildReturnCodeTypes.cancelled, null);
    });

    return new Promise<number>(async function (resolve, reject): Promise<void> {
        // Expand {REPO:VSCODE-MAKEFILE-TOOLS} to the full path of the root of the extension
        // This is used for the pre-created dry-run logs consumed by the tests,
        // in order to be able to have source files and includes for the test repro
        // within the test subfolder of the extension repo, while still exercising full paths for parsing
        // and not generating a different output with every new location where Makefile Tools is enlisted.
        // A real user scenario wouldn't need this construct.

        await scheduleTask(async (taskEndCallback: () => void) => {
            function doChunk1(level: number): void {
                statusCallback("Preprocessing the dry-run output...1");
                if (level === 1) {
                    let extensionRootPath: string = path.resolve(__dirname, "../../");
                    preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);

                    // Split multiple commands concatenated by '&&'
                    preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/ && /g, "\n");

                    // Split multiple commands concatenated by ";"
                    preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/;/g, "\n");

                    // Concatenate lines ending with ' \', forming one complete command
                    preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/\\r\\n/mg, "\n");
                    taskEndCallback();
                } else {
                    setTimeout(doChunk1, 0, 1);
                }
            }

            doChunk1(0);
        }); // scheduleTask

        let regexp: RegExp = /\s+\\$/mg;
        let match: RegExpExecArray | null = regexp.exec(preprocessedDryRunOutputStr);

        if (match) {
            await scheduleTask(async (taskEndCallback: () => void) => {
                function doChunk2(): void {
                    let chunkIndex: number = 0;
                    while (match) {
                        if (cancel.isCancellationRequested) {
                            break;
                        }

                        statusCallback("Preprocessing the dry-run output...2");
                        let result: string = match[0];
                        result = result.concat("\n");
                        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(result, " ");
                        match = regexp.exec(preprocessedDryRunOutputStr);

                        if (!match) {
                            taskEndCallback();
                        }

                        chunkIndex++;
                        if (chunkIndex === chunkSize) {
                            setTimeout(doChunk2, 0);
                        }
                    } // while loop
                } // doChunk2
                doChunk2();
            }); // scheduleTask
        } // if match

        // Process some more makefile output weirdness
        let preprocessedDryRunOutputLines: string[] = [];
        let preprocessedLines: string[] = preprocessedDryRunOutputStr.split("\n");
        let numberOfLines: number = preprocessedLines.length;
        let index: number = 0;

        await scheduleTask(async (taskEndCallback: () => void) => {
            function doChunk3(): void {
                let chunkIndex: number = 0;
                while (index < numberOfLines && chunkIndex <= chunkSize) {
                    if (cancel.isCancellationRequested) {
                        break;
                    }

                    let line: string = preprocessedLines[index];

                    statusCallback("Preprocessing the dry-run output...3");
                    let strC: string = "--mode=compile";
                    let idxC: number = line.indexOf(strC);
                    if (idxC >= 0) {
                        line = line.replace(line.substring(0, idxC), "");
                        line = line.replace(strC, "");
                    }

                    let strL: string = "--mode=link";
                    let idxL: number = line.indexOf(strL);
                    if (idxL >= 0) {
                        line = line.replace(line.substring(0, idxL), "");
                        line = line.replace(strL, "");
                    }

                    // Ignore any lines containing $ because they are redundant and not useful
                    // for IntelliSense config provider or launch parsing.
                    // These lines are produced by the verbose log switch --print-data-base,
                    // which is useful in parsing for build targets.
                    if (!line.includes("$(")) {
                        preprocessedDryRunOutputLines.push(line);
                    }

                    if (idxL >= 0 && idxC >= 0) {
                        logger.message("Not supporting --mode=compile and --mode=link on the same line");
                    }

                    index++;
                    if (index === numberOfLines) {
                        taskEndCallback();
                    }

                    chunkIndex++;
                    if (chunkIndex === chunkSize) {
                        setTimeout(doChunk3, 0);
                    }
                } // while loop
            } // doChunk3
            doChunk3();
        }); // scheduleTask

        await scheduleTask(async (taskEndCallback: () => void) => {
            function doChunk4(level: number): void {
                statusCallback("Preprocessing the dry-run output...4");

                if (level === 1) {
                    preprocessedDryRunOutputStr = preprocessedDryRunOutputLines.join("\n");

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
                        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/ \/link /g, "/link \n link.exe ");
                    }

                    taskEndCallback();
                } else {
                    setTimeout(doChunk4, 0, 1);
                }
            }

            doChunk4(0);
        }); // scheduleTask

        endCallback(make.ConfigureBuildReturnCodeTypes.success, preprocessedDryRunOutputStr);
        resolve(make.ConfigureBuildReturnCodeTypes.success);
    });

    // TODO: Insert preprocessed files content

    // TODO: Wrappers (example: cl.cmd)
}
interface ToolInvocation {
    // how the makefile invokes the tool:
    // relative -to the makefile location- path, full path, explicit current directory or no path
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
    // - with or without path (relative -to the makefile location- or full)
    // - with or without extension (windows only)
    // - with or without quotes
    // - must have at least one space or tab after the tool invocation
    let regexpStr: string = '^[\\s\\"]*(.*?)(';
    if (process.platform === "win32") {
        regexpStr += toolNames.join('\\.exe|');

        // make sure to append extension if the array of tools has only one element,
        // in which case .join is not doing anything
        if (toolNames.length === 1) {
            regexpStr += ('\\.exe');
        }

        regexpStr += '|';
    }

    regexpStr += toolNames.join('|') + ')[\\s\\"]+(.*)$';

    let regexp: RegExp = RegExp(regexpStr, "mg");
    let match: RegExpExecArray | null = regexp.exec(line);

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
// todo: refactor common parts in parseMultipleSwitchFromToolArguments and parseSingleSwitchFromToolArguments
function parseMultipleSwitchFromToolArguments(args: string, sw: string): string[] {
    // - '-' or '/' or '--' as switch prefix
    // - before each switch, we allow only for one or more spaces/tabs OR begining of line,
    //   to reject a case where a part of a path looks like a switch with its value
    // - can be wrapped by a pair of ', before the switch prefix and after the switch value
    // - the value can be wrapped by a pair of "
    // - one or none or more spaces/tabs between the switch and the value
    let regexpStr: string = '(^|\\s+)\\\'?(\\/' + sw + '(:|=|\\s*)|-' + sw + '(:|=|\\s*)|--' + sw + '(:|=|\\s*))(\\".*?\\"|[^\\\'\\s]+)\\\'?';
    let regexp: RegExp = RegExp(regexpStr, "mg");
    let match: RegExpExecArray | null;
    let results: string[] = [];

    match = regexp.exec(args);
    while (match) {
        let result: string = match[6];
        if (result) {
            result = result.trim();
            result = result.replace(/"/g, "");
            results.push(result);
        }
        match = regexp.exec(args);
    }

    return results;
}

// Helper that parses for any switch from a set that can occur one or more times
// in the tool command line and returns an array of the values passed via all of the identified switches.
// It is based on parseMultipleSwitchFromToolArguments (extends the regex for more switches
// and also accepts a switch without a following value, like -m32 or -m64 are different from -arch:arm).
// This is useful especially when we need the order of these different switches in the command line:
// for example, when we want to know which switch wins (for cancelling pairs or for overriding switches).
// Parsing the switches separately wouldn't give us the order information.
// Also, we don't have yet a function to parse the whole string of arguments into individual arguments,
// so that we anaylze each switch one by one, thus knowing the order.
function parseMultipleSwitchesFromToolArguments(args: string, simpleSwitches: string[], valueSwitches: string[]): string[] {
    // - '-' or '/' or '--' as switch prefix
    // - before each switch, we allow only for one or more spaces/tabs OR begining of line,
    //   to reject a case where a part of a path looks like a switch with its value
    // - can be wrapped by a pair of ', before the switch prefix and after the switch value
    // - the value can be wrapped by a pair of "
    // - one or none or more spaces/tabs between the switch and the value
    let regexpStr: string = '(^|\\s+)\\\'?(';
    valueSwitches.forEach(sw => {
        regexpStr += '\\/' + sw + '(:|=|\\s*)|-' + sw + '(:|=|\\s*)|--' + sw + '(:|=|\\s*)';
        // Make sure we don't append '|' after the last extension value
        if (sw !== valueSwitches[valueSwitches.length - 1]) {
            regexpStr += '|';
        }
    });
    regexpStr += ')(\\".*?\\"|[^\\\'\\s]+)';
    regexpStr += '|((\\/|-|--)(' + simpleSwitches.join('|') + '))';
    regexpStr += '\\\'?';

    let regexp: RegExp = RegExp(regexpStr, "mg");
    let match: RegExpExecArray | null;
    let results: string[] = [];

    match = regexp.exec(args);
    while (match) {
        // If the current match is a simple switch, find it at index 15, otherwise at 12.
        // In each scenario, only one will have a value while the other is undefined.
        let result: string = match[12] || match[15];
        if (result) {
            result = result.trim();
            result = result.replace(/"/g, "");
            results.push(result);
        }
        match = regexp.exec(args);
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
    // - '-' or '/' or '--' as switch prefix
    // - before the switch, we allow only for one or more spaces/tabs OR begining of line,
    //   to reject a case where a part of a path looks like a switch with its value
    // - can be wrapped by a pair of ', before the switch prefix and after the switch value
    // - the value can be wrapped by a pair of "
    // -  ':' or '=' or one/none/more spaces/tabs between the switch and the value
    let regexpStr: string = '(^|\\s+)\\\'?(\\/|-|--)(' + sw.join("|") + ')(:|=|\\s*)(\\".*?\\"|[^\\\'\\s]+)\\\'?';
    let regexp: RegExp = RegExp(regexpStr, "mg");
    let match: RegExpExecArray | null;
    let results: string[] = [];

    match = regexp.exec(args);
    while (match) {
        let result: string = match[5];
        if (result) {
            result = result.trim();
            result = result.replace(/"/g, "");
            results.push(result);
        }
        match = regexp.exec(args);
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
function isSwitchPassedInArguments(args: string, sw: string[]): boolean {
    // - '-' or '/' or '--' as switch prefix
    // - one or more spaces/tabs after
    let regexpStr: string = '((\\s+)|^)(\\/|-|--)(' + sw.join("|") + ')((\\s+)|$)';
    let regexp: RegExp = RegExp(regexpStr, "mg");

    if (regexp.exec(args)) {
        return true;
    }

    return false;
}

// Helper that parses for files (of given extensions) that are given as arguments to a tool
// TODO: consider non standard extensions (or no extension at all) in the presence of TC/TP.
// Attention to obj, pdb or exe files tied to /Fo, /Fd and /Fe
// TODO: consider also ' besides "
function parseFilesFromToolArguments(args: string, exts: string[]): string[] {
    // no switch prefix and no association yet with a preceding switch
    // one or more spaces/tabs before (or beginning of line) and after (or end of line)
    // with or without quotes surrounding the argument
    //    - if surrounding quotes, don't allow another quote in between
    // (todo: handle the scenario when quotes enclose just the directory path, without the file name)
    let regexpStr: string = '(';
    exts.forEach(ext => {
        regexpStr += '\\".[^\\"]*?\\.' + ext + '\\"|';
        regexpStr += '\\S+\\.' + ext;
        // Make sure we don't append '|' after the last extension value
        if (ext !== exts[exts.length - 1]) {
            regexpStr += '|';
        }
    });
    regexpStr += ')(\\s+|$)';

    let regexp: RegExp = RegExp(regexpStr, "mg");
    let match: string[] | null;
    let files: string[] = [];

    match = regexp.exec(args);
    while (match) {
        let result: string = match[1];
        if (result) {
            result = result.trim();
            result = result.replace(/"/g, "");
            files.push(result);
        }
        match = regexp.exec(args);
    }

    return files;
}

// Helper that identifies system commands (cd, cd -, pushd, popd) and make.exe change directory switch (-C)
// to calculate the effect on the current path, also remembering the transition in the history stack.
// The current path is always the last one into the history.
function currentPathAfterCommand(line: string, currentPathHistory: string[]): string[] {
    line = line.trimLeft();
    line = line.trimRight();

    let lastCurrentPath: string = (currentPathHistory.length > 0) ? currentPathHistory[currentPathHistory.length - 1] : "";
    let newCurrentPath: string = "";

    if (line.startsWith('cd -')) {
        // Swap the last two current paths in the history.
        if (lastCurrentPath) {
            currentPathHistory.pop();
        }

        let lastCurrentPath2: string = (currentPathHistory.length > 0) ? currentPathHistory.pop() || "" : lastCurrentPath;

        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("CD- command: leaving directory " + lastCurrentPath + " and entering directory " + lastCurrentPath2, "Verbose");
        currentPathHistory.push(lastCurrentPath);
        currentPathHistory.push(lastCurrentPath2);
    } else if (line.startsWith('popd') || line.includes('Leaving directory')) {
        let lastCurrentPath: string = (currentPathHistory.length > 0) ? currentPathHistory[currentPathHistory.length - 1] : "";
        currentPathHistory.pop();
        let lastCurrentPath2: string = (currentPathHistory.length > 0) ? currentPathHistory[currentPathHistory.length - 1] : "";
        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("POPD command or end of MAKE -C: leaving directory " + lastCurrentPath + " and entering directory " + lastCurrentPath2, "Verbose");
    } else if (line.startsWith('cd')) {
        newCurrentPath = util.makeFullPath(line.slice(3), lastCurrentPath);

        // For "cd-" (which toggles between the last 2 current paths),
        // we must always keep one previous current path in the history.
        // Don't pop if the history has only one path as of now,
        // even if this wasn't a pushd.
        if (currentPathHistory.length > 1) {
            currentPathHistory = [];
            currentPathHistory.push(lastCurrentPath);
        }

        currentPathHistory.push(newCurrentPath);
        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("CD command: entering directory " + newCurrentPath, "Verbose");
    } else if (line.startsWith('pushd')) {
        newCurrentPath = util.makeFullPath(line.slice(6), lastCurrentPath);
        currentPathHistory.push(newCurrentPath);
        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("PUSHD command: entering directory " + newCurrentPath, "Verbose");
    } else if (line.includes('Entering directory')) { // equivalent to pushd
        // The make switch print-directory wraps the folder in various ways.
        let match: RegExpMatchArray | null = line.match("(.*)(Entering directory ['|`|\"])(.*)['|`|\"]");
        if (match) {
            newCurrentPath = util.makeFullPath(match[3], lastCurrentPath) || "";
        } else {
            newCurrentPath = "Could not parse directory";
        }

        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("MAKE -C: entering directory " + newCurrentPath, "Verbose");
        currentPathHistory.push(newCurrentPath);
    }

    return currentPathHistory;
}

export interface CustomConfigProviderItem {
    defines: string[];
    includes: string[];
    forcedIncludes: string[];
    standard: util.StandardVersion;
    intelliSenseMode: util.IntelliSenseMode;
    compilerFullPath: string;
    files: string[];
    windowsSDKVersion?: string;
}

// Parse the output of the make dry-run command in order to provide CppTools
// with information about includes, defines, compiler path....etc...
// as needed by CustomConfigurationProvider
export async function parseCustomConfigProvider(cancel: vscode.CancellationToken, dryRunOutputStr: string,
                                                statusCallback: (message: string) => void,
                                                onFoundCustomConfigProviderItem: (customConfigProviderItem: CustomConfigProviderItem) => void,
                                                endCallback: (retc: number) => void): Promise<number> {
    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

    cancel.onCancellationRequested(() => {
        endCallback(make.ConfigureBuildReturnCodeTypes.cancelled);
    });

    return new Promise<number>(async function (resolve, reject): Promise<void> {
        logger.message('Parsing dry-run output for CppTools Custom Configuration Provider.');

        // Empty the cummulative browse path built during the previous dry-run parsing
        cpptools.clearCummulativeBrowsePath();

        // Current path starts with workspace root and can be modified
        // with prompt commands like cd, cd-, pushd/popd or with -C make switch
        let currentPath: string = vscode.workspace.rootPath || "";
        let currentPathHistory: string[] = [currentPath];

        // Read the dry-run output line by line, searching for compilers and directory changing commands
        // to construct information for the CppTools custom configuration
        let dryRunOutputLines: string[] = dryRunOutputStr.split("\n");
        let numberOfLines: number = dryRunOutputLines.length;
        let index: number = 0;

        function doChunk(): void {
            let chunkIndex: number = 0;
            while (index < numberOfLines && chunkIndex <= chunkSize) {
                if (cancel.isCancellationRequested) {
                    break;
                }

                let line: string = dryRunOutputLines[index];

                statusCallback("Parsing for IntelliSense...");
                currentPathHistory = currentPathAfterCommand(line, currentPathHistory);
                currentPath = currentPathHistory[currentPathHistory.length - 1];

                let compilerTool: ToolInvocation | undefined = parseLineAsTool(line, compilers, currentPath);
                if (compilerTool) {
                    logger.message("Found compiler command: " + line, "Verbose");

                    // Compiler path is either what the makefile provides or found in the PATH environment variable or empty
                    let compilerFullPath: string = compilerTool.fullPath || "";
                    if (!compilerTool.found) {
                        let toolBaseName: string = path.basename(compilerFullPath);
                        compilerFullPath = path.join(util.toolPathInEnv(toolBaseName) || "", toolBaseName);
                    }
                    logger.message("    Compiler path: " + compilerFullPath, "Verbose");

                    // Parse and log the includes, forced includes and the defines
                    let includes: string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'I');
                    includes = util.makeFullPaths(includes, currentPath);
                    logger.message("    Includes: " + includes.join(";"), "Verbose");
                    let forcedIncludes: string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'FI');
                    forcedIncludes = util.makeFullPaths(forcedIncludes, currentPath);
                    logger.message("    Forced includes: " + forcedIncludes.join(";"), "Verbose");

                    // TODO-BUG: fix regexp for parseMultipleSwitchFromToolArguments
                    // Include dirs not detected properly in 8cc (because of '" "')
                    let defines: string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'D');
                    logger.message("    Defines: " + defines.join(";"), "Verbose");

                    // Parse the IntelliSense mode
                    // how to deal with aliases and symlinks (CC, C++), which can point to any toolsets
                    let targetArchitecture: util.TargetArchitecture = getTargetArchitecture(compilerTool.arguments);
                    let intelliSenseMode: util.IntelliSenseMode = getIntelliSenseMode(ext.extension.getCppToolsVersion(), compilerFullPath, targetArchitecture);
                    logger.message("    IntelliSense mode: " + intelliSenseMode, "Verbose");

                    // For windows, parse the sdk version
                    let windowsSDKVersion: string | undefined = "";
                    if (process.platform === "win32") {
                        windowsSDKVersion = process.env["WindowsSDKVersion"];
                        if (windowsSDKVersion) {
                            logger.message('Windows SDK Version: ' + windowsSDKVersion, "Verbose");
                        }
                    }

                    // Parse the source files
                    let files: string[] = parseFilesFromToolArguments(compilerTool.arguments, sourceFileExtensions);
                    files = util.makeFullPaths(files, currentPath);
                    logger.message("    Source files: " + files.join(";"), "Verbose");

                    // The language represented by this compilation command
                    let language: util.Language;
                    let hasC: boolean = files.filter(file => (file.endsWith(".c"))).length > 0;
                    let hasCpp: boolean = files.filter(file => (file.endsWith(".cpp"))).length > 0;
                    if (hasC && !hasCpp) {
                        language = "c";
                    } else if (hasCpp && !hasC) {
                        language = "cpp";
                    }

                    // /TP and /TC (for cl.exe only) overwrite the meaning of the source files extensions
                    if (isSwitchPassedInArguments(compilerTool.arguments, ['TP'])) {
                        language = "cpp";
                    } else if (isSwitchPassedInArguments(compilerTool.arguments, ['TC'])) {
                        language = "c";
                    }

                    // Parse the C/C++ standard as given in the compiler command line
                    let standardStr: string | undefined = parseSingleSwitchFromToolArguments(compilerTool.arguments, ["std"]);

                    // If the command is compiling the same extension or uses -TC/-TP, send all the source files in one batch.
                    if (language) {
                        // More standard validation and defaults, in the context of the whole command.
                        let standard: util.StandardVersion = parseStandard(ext.extension.getCppToolsVersion(), standardStr, language);
                        logger.message("    Standard: " + standard, "Verbose");

                        if (ext.extension) {
                            onFoundCustomConfigProviderItem({ defines, includes, forcedIncludes, standard, intelliSenseMode, compilerFullPath, files, windowsSDKVersion });
                        }
                    } else {
                        // If the compiler command is mixing c and c++ source files, send a custom configuration for each of the source files separately,
                        // to be able to accurately validate and calculate the standard based on the correct language.
                        files.forEach(file => {
                            if (file.endsWith(".cpp")) {
                                language = "cpp";
                            } else if (file.endsWith(".c")) {
                                language = "c";
                            }

                            // More standard validation and defaults, in the context of each source file.
                            let standard: util.StandardVersion = parseStandard(ext.extension.getCppToolsVersion(), standardStr, language);
                            logger.message("    Standard: " + standard, "Verbose");

                            if (ext.extension) {
                                onFoundCustomConfigProviderItem({ defines, includes, forcedIncludes, standard, intelliSenseMode, compilerFullPath, files: [file], windowsSDKVersion });
                            }
                        });
                    }
                } // if (compilerTool) {

                index++;
                if (index === numberOfLines) {
                    resolve(make.ConfigureBuildReturnCodeTypes.success);
                    endCallback(make.ConfigureBuildReturnCodeTypes.success);
                }

                chunkIndex++;
                if (chunkIndex === chunkSize) {
                    setTimeout(doChunk, 0);
                }
            } // while loop
        } // doChunk function

        doChunk();
    }); // return new promise
}

// Target binaries arguments special handling
function filterTargetBinaryArgs(args: string[]): string[] {
    let processedArgs: string[] = [];

    args.forEach(arg => {
        // Once we encounter a redirection character (pipe, stdout/stderr) remove it,
        // together with all the arguments that are following,
        // since they are not real parameters of the binary tool that is analyzed.
        if (arg === '>' || arg === '1>' || arg === '2>' || arg === '|') {
            return processedArgs;
        }

        processedArgs.push(arg);
    });

    return processedArgs;
}

// Parse the output of the make dry-run command in order to provide VS Code debugger
// with information about binaries, their execution paths and arguments
export async function parseLaunchConfigurations(cancel: vscode.CancellationToken, dryRunOutputStr: string,
                                                statusCallback: (message: string) => void,
                                                onFoundLaunchConfiguration: (launchConfiguration: configuration.LaunchConfiguration) => void,
                                                endCallback: (retc: number) => void): Promise<number> {
    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

    cancel.onCancellationRequested(() => {
        endCallback(make.ConfigureBuildReturnCodeTypes.cancelled);
    });

    return new Promise<number>(async function (resolve, reject): Promise<void> {
        // Current path starts with workspace root and can be modified
        // with prompt commands like cd, cd-, pushd/popd or with -C make switch
        let currentPath: string = vscode.workspace.rootPath || "";
        let currentPathHistory: string[] = [currentPath];

        // array of full path executables built by this makefile
        let targetBinaries: string[] = [];

        // The first pass of reading the dry-run output, line by line
        // searching for compilers, linkers and directory changing commands
        // to construct information for the launch configuration
        let dryRunOutputLines: string[] = dryRunOutputStr.split("\n");
        let numberOfLines: number = dryRunOutputLines.length;
        let index: number = 0;

        await scheduleTask(async (taskEndCallback: () => void) => {
            function doChunk1(): void {
                let chunkIndex: number = 0;
                while (index < numberOfLines && chunkIndex <= chunkSize) {
                    if (cancel.isCancellationRequested) {
                        break;
                    }

                    let line: string = dryRunOutputLines[index];

                    statusCallback("Parsing for launch targets... (inspecting for link commands");
                    currentPathHistory = currentPathAfterCommand(line, currentPathHistory);
                    currentPath = currentPathHistory[currentPathHistory.length - 1];

                    // A target binary is usually produced by the linker with the /out or /o switch,
                    // but there are several scenarios (for win32 Microsoft cl.exe)
                    // when the compiler is producing an output binary directly (via the /Fe switch)
                    // or indirectly (based on some naming default rules in the absence of /Fe)
                    let linkerTargetBinary: string | undefined;
                    let compilerTargetBinary: string | undefined;

                    if (process.platform === "win32") {
                        let compilerTool: ToolInvocation | undefined = parseLineAsTool(line, compilers, currentPath);
                        if (compilerTool) {
                            // If a cl.exe is not performing only an obj compilation, deduce the output executable if possible
                            // Note: no need to worry about the DLL case that this extension doesn't support yet
                            // since a compiler can produce implicitly only an executable.

                            if (path.basename(compilerTool.fullPath).startsWith("cl")) {
                                if (!isSwitchPassedInArguments(compilerTool.arguments, ["c", "P", "E", "EP"])) {
                                    logger.message("Found compiler command:\n" + line, "Verbose");

                                    // First read the value of the /Fe switch (for cl.exe)
                                    compilerTargetBinary = parseSingleSwitchFromToolArguments(compilerTool.arguments, ["Fe"]);

                                    // Then assume first object file base name (defined with /Fo) + exe
                                    // The binary is produced in the same folder where the compiling operation takes place,
                                    // and not in an eventual different obj path.
                                    // Note: /Fo is not allowed on multiple sources compilations so there will be only one if found
                                    if (!compilerTargetBinary) {
                                        let objFile: string | undefined = parseSingleSwitchFromToolArguments(compilerTool.arguments, ["Fo"]);
                                        if (objFile) {
                                            let parsedObjPath: path.ParsedPath = path.parse(objFile);
                                            compilerTargetBinary = parsedObjPath.name + ".exe";
                                            logger.message("The compiler command is not producing a target binary explicitly. Assuming " +
                                                compilerTargetBinary + " from the first object passed in with /Fo", "Verbose");
                                        }
                                    } else {
                                        logger.message("Producing target binary with /Fe: " + compilerTargetBinary, "Verbose");
                                    }

                                    // Then assume first source file base name + exe.
                                    // The binary is produced in the same folder where the compiling operation takes place,
                                    // and not in an eventual different source path.
                                    if (!compilerTargetBinary) {
                                        let srcFiles: string[] | undefined = parseFilesFromToolArguments(compilerTool.arguments, sourceFileExtensions);
                                        if (srcFiles.length >= 1) {
                                            let parsedSourcePath: path.ParsedPath = path.parse(srcFiles[0]);
                                            compilerTargetBinary = parsedSourcePath.name + ".exe";
                                            logger.message("The compiler command is not producing a target binary explicitly. Assuming " +
                                                compilerTargetBinary + " from the first source file passed in", "Verbose");
                                        }
                                    }
                                }
                            }

                            if (compilerTargetBinary) {
                                compilerTargetBinary = util.makeFullPath(compilerTargetBinary, currentPath);
                            }
                        }
                    }

                    let linkerTool: ToolInvocation | undefined = parseLineAsTool(line, linkers, currentPath);
                    if (linkerTool) {
                        // TODO: implement launch support for DLLs and LIBs, besides executables.
                        if (!isSwitchPassedInArguments(linkerTool.arguments, ["dll", "lib", "shared"])) {
                            // Gcc/Clang tools can also perform linking so don't parse any output binary
                            // if there are switches passed in to cause early stop of compilation: -c, -E, -S
                            // (-o will not point to an executable)
                            // Also, the ld switches -r and -Ur do not produce executables.
                            if (!isSwitchPassedInArguments(linkerTool.arguments, ["c", "E", "S", "r", "Ur"])) {
                                linkerTargetBinary = parseSingleSwitchFromToolArguments(linkerTool.arguments, ["out", "o"]);
                                logger.message("Found linker command: " + line, "Verbose");

                                if (!linkerTargetBinary) {
                                    // For Microsoft link.exe, the default output binary takes the base name
                                    // of the first file (obj, lib, etc...) that is passed to the linker.
                                    // The binary is produced in the same folder where the linking operation takes place,
                                    // and not in an eventual different obj/lib path.
                                    if (process.platform === "win32" && path.basename(linkerTool.fullPath).startsWith("link")) {
                                        let files: string[] = parseFilesFromToolArguments(linkerTool.arguments, ["obj", "lib"]);
                                        if (files.length >= 1) {
                                            let parsedPath: path.ParsedPath = path.parse(files[0]);
                                            let targetBinaryFromFirstObjLib: string = parsedPath.name + ".exe";
                                            logger.message("The link command is not producing a target binary explicitly. Assuming " +
                                                targetBinaryFromFirstObjLib + " based on first object passed in", "Verbose");
                                            linkerTargetBinary = targetBinaryFromFirstObjLib;
                                        }
                                    } else {
                                        // The default output binary from a linking operation is usually a.out on linux/mac,
                                        // produced in the same folder where the toolset is run.
                                        logger.message("The link command is not producing a target binary explicitly. Assuming a.out", "Verbose");
                                        linkerTargetBinary = "a.out";
                                    }
                                } else {
                                    logger.message("Producing target binary: " + linkerTargetBinary, "Verbose");
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
                    // Also for gcc/clang, -o switch or the default output will be a .o in the presence of -c and an executable otherwise.
                    let targetBinary: string | undefined = linkerTargetBinary || compilerTargetBinary;
                    if (targetBinary) {
                        targetBinaries.push(targetBinary);

                        // Include limited launch configuration, when only the binary is known,
                        // in which case the execution path is defaulting to workspace root folder
                        // and there are no args.
                        let launchConfiguration: configuration.LaunchConfiguration = {
                            binaryPath: targetBinary,
                            cwd: vscode.workspace.rootPath || "",
                            binaryArgs: []
                        };

                        logger.message("Adding launch configuration:\n" + configuration.launchConfigurationToString(launchConfiguration), "Verbose");
                        onFoundLaunchConfiguration(launchConfiguration);
                    }

                    index++;
                    if (index === numberOfLines) {
                        taskEndCallback();
                    }

                    chunkIndex++;
                    if (chunkIndex === chunkSize) {
                        setTimeout(doChunk1, 0);
                    }
                } // while loop
            } // doChunk1 function

            doChunk1();
        }); // scheduleTask

        // If no binaries are found to be built, there is no point in parsing for invoking targets
        if (targetBinaries.length === 0) {
            resolve(make.ConfigureBuildReturnCodeTypes.success);
            endCallback(make.ConfigureBuildReturnCodeTypes.success);
            return;
        }

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
        let targetBinariesNames: string[] = [];
        targetBinaries.forEach(target => {
            let parsedPath: path.ParsedPath = path.parse(target);
            if (!targetBinariesNames.includes(parsedPath.name)) {
                targetBinariesNames.push(parsedPath.name);
            }
        });

        index = 0;
        function doChunk2(): void {
            let chunkIndex: number = 0;
            while (index < numberOfLines && chunkIndex <= chunkSize) {
                if (cancel.isCancellationRequested) {
                    break;
                }

                let line: string = dryRunOutputLines[index];

                statusCallback("Parsing for launch targets... (inspecting built binary invocations).");
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
                let targetBinaryTool: ToolInvocation | undefined = parseLineAsTool(line, targetBinariesNames, currentPath);
                if (targetBinaryTool) {
                    logger.message("Found binary execution command: " + line, "Verbose");
                    // Include complete launch configuration: binary, execution path and args
                    // are known from parsing the dry-run
                    let splitArgs: string[] = targetBinaryTool.arguments ? targetBinaryTool.arguments.split(" ") : [];
                    if (splitArgs.length > 0) {
                        splitArgs = filterTargetBinaryArgs(splitArgs);
                    }

                    let launchConfiguration: configuration.LaunchConfiguration = {
                        binaryPath: targetBinaryTool.fullPath,
                        cwd: currentPath,
                        // TODO: consider optionally quoted arguments
                        binaryArgs: splitArgs
                    };

                    logger.message("Adding launch configuration:\n" + configuration.launchConfigurationToString(launchConfiguration), "Verbose");
                    onFoundLaunchConfiguration(launchConfiguration);
                }

                index++;
                if (index === numberOfLines) {
                    resolve(make.ConfigureBuildReturnCodeTypes.success);
                    endCallback(make.ConfigureBuildReturnCodeTypes.success);
                }

                chunkIndex++;
                if (chunkIndex === chunkSize) {
                    setTimeout(doChunk2, 0);
                }
            } // while loop
        } // doChunk2 function

        doChunk2();
    }); // return promise
}

/**
 * Determine the IntelliSenseMode based on hints from compiler path
 * and target architecture parsed from compiler flags.
 */
function getIntelliSenseMode(cppVersion: cpp.Version | undefined, compilerPath: string, targetArch: util.TargetArchitecture): util.IntelliSenseMode {
    const canUseArm: boolean = (cppVersion !== undefined && cppVersion >= cpp.Version.v4);
    const compilerName: string = path.basename(compilerPath || "").toLocaleLowerCase();
    if (compilerName === 'cl.exe') {
        const clArch: string = path.basename(path.dirname(compilerPath)).toLocaleLowerCase();
        switch (clArch) {
            case 'arm64':
                return canUseArm ? 'msvc-arm64' : 'msvc-x64';
            case 'arm':
                return canUseArm ? 'msvc-arm' : 'msvc-x86';
            case 'x86':
                return 'msvc-x86';
            case 'x64':
            default:
                return 'msvc-x64';
        }
    } else if (compilerName.indexOf('armclang') >= 0) {
        switch (targetArch) {
            case 'arm64':
                return canUseArm ? 'clang-arm64' : 'clang-x64';
            case 'arm':
            default:
                return canUseArm ? 'clang-arm' : 'clang-x86';
        }
    } else if (compilerName.indexOf('clang') >= 0) {
        switch (targetArch) {
            case 'arm64':
                return canUseArm ? 'clang-arm64' : 'clang-x64';
            case 'arm':
                return canUseArm ? 'clang-arm' : 'clang-x86';
            case 'x86':
                return 'clang-x86';
            case 'x64':
            default:
                return 'clang-x64';
        }
    } else if (compilerName.indexOf('aarch64') >= 0) {
        // Compiler with 'aarch64' in its name may also have 'arm', so check for
        // aarch64 compilers before checking for ARM specific compilers.
        return canUseArm ? 'gcc-arm64' : 'gcc-x64';
    } else if (compilerName.indexOf('arm') >= 0) {
        return canUseArm ? 'gcc-arm' : 'gcc-x86';
    } else if (compilerName.indexOf('gcc') >= 0 || compilerName.indexOf('g++') >= 0) {
        switch (targetArch) {
            case 'x86':
                return 'gcc-x86';
            case 'x64':
            default:
                return 'gcc-x64';
        }
    } else {
        // unknown compiler; pick platform defaults.
        if (process.platform === 'win32') {
            return 'msvc-x64';
        } else if (process.platform === 'darwin') {
            return 'clang-x64';
        } else {
            return 'gcc-x64';
        }
    }
}

/**
 * Determine the target architecture from the compiler flags present in the given compilation command.
 */
function getTargetArchitecture(compilerArgs: string): util.TargetArchitecture {
    // Go through all the possible target architecture switches.
    // For each switch, apply a set of rules to identify the target arch.
    // The last switch wins.
    let possibleArchs: string[] = parseMultipleSwitchesFromToolArguments(compilerArgs, ["m32", "m64"], ["arch", "march", "target"]);
    let targetArch: util.TargetArchitecture; // this starts as undefined

    possibleArchs.forEach(arch => {
        if (arch === "m32") {
            targetArch = "x86";
        } else if (arch === "m64") {
            targetArch = "x64";
        } else if (arch === "i686") {
            targetArch = "x86";
        } else if (arch === "amd64" || arch === "x86_64") {
            targetArch = "x64";
        } else if (arch === "aarch64" || arch === "armv8-a" || arch === "armv8.") {
            targetArch = "arm64";
        } else if (arch === "arm" || arch === "armv8-r" || arch === "armv8-m") {
            targetArch = "arm";
        } else {
            // Check if ARM version is 7 or earlier.
            const verStr: string | undefined = arch?.substr(5, 1);
            if (verStr) {
                const verNum: number = +verStr;
                if (verNum <= 7) {
                    targetArch = "arm";
                }
            }
        }
    });

    return targetArch;
}

function parseStandard(cppVersion: cpp.Version | undefined, std: string | undefined, language: util.Language): util.StandardVersion {
    let canUseGnu: boolean = (cppVersion !== undefined && cppVersion >= cpp.Version.v4);
    let standard: util.StandardVersion;
    if (!std) {
        // Standard defaults when no std switch is given
        if (language === "c") {
            return "c11";
        } else if (language === "cpp") {
            return "c++17";
        }
    } else if (language === "cpp") {
        standard = parseCppStandard(std, canUseGnu);
        if (!standard) {
            logger.message(`Unknown C++ standard control flag: ${std}`);
        }
    } else if (language === "c") {
        standard = parseCStandard(std, canUseGnu);
        if (!standard) {
            logger.message(`Unknown C standard control flag: ${std}`);
        }
    } else if (language === undefined) {
        standard = parseCppStandard(std, canUseGnu);
        if (!standard) {
            standard = parseCStandard(std, canUseGnu);
        }
        if (!standard) {
            logger.message(`Unknown standard control flag: ${std}`);
        }
    } else {
        logger.message("Unknown language");
    }

    return standard;
}

function parseCppStandard(std: string, canUseGnu: boolean): util.StandardVersion {
    const isGnu: boolean = canUseGnu && std.startsWith('gnu');
    if (std.endsWith('++2a') || std.endsWith('++20') || std.endsWith('++latest')) {
      return isGnu ? 'gnu++20' : 'c++20';
    } else if (std.endsWith('++17') || std.endsWith('++1z')) {
      return isGnu ? 'gnu++17' : 'c++17';
    } else if (std.endsWith('++14') || std.endsWith('++1y')) {
      return isGnu ? 'gnu++14' : 'c++14';
    } else if (std.endsWith('++11') || std.endsWith('++0x')) {
      return isGnu ? 'gnu++11' : 'c++11';
    } else if (std.endsWith('++03')) {
      return isGnu ? 'gnu++03' : 'c++03';
    } else if (std.endsWith('++98')) {
      return isGnu ? 'gnu++98' : 'c++98';
    } else {
      return undefined;
    }
  }

  function parseCStandard(std: string, canUseGnu: boolean): util.StandardVersion {
    // GNU options from: https://gcc.gnu.org/onlinedocs/gcc/C-Dialect-Options.html#C-Dialect-Options
    const isGnu: boolean = canUseGnu && std.startsWith('gnu');
    if (/(c|gnu)(90|89|iso9899:(1990|199409))/.test(std)) {
      return isGnu ? 'gnu89' : 'c89';
    } else if (/(c|gnu)(99|9x|iso9899:(1999|199x))/.test(std)) {
      return isGnu ? 'gnu99' : 'c99';
    } else if (/(c|gnu)(11|1x|iso9899:2011)/.test(std)) {
      return isGnu ? 'gnu11' : 'c11';
    } else if (/(c|gnu)(17|18|iso9899:(2017|2018))/.test(std)) {
      if (canUseGnu) {
        // cpptools supports 'c18' in same version it supports GNU std.
        return isGnu ? 'gnu18' : 'c18';
      } else {
        return 'c11';
      }
    } else {
      return undefined;
    }
  }

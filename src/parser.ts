// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// TODO: support also the scenario of parsing a build log,
// to overcome some of --dry-run limitations
// (like some exceptions to the 'do not execute' rule
// or dependencies on a real build)

import * as configuration from './configuration';
import * as cpp from 'vscode-cpptools';
import * as ext from './extension';
import * as logger from './logger';
import * as make from './make';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';

// List of compiler tools plus the most common aliases cc and c++
// ++ needs to be escaped for the regular expression in parseLineAsTool.
// Versioning and cross compilers naming variations dont' need to be included in this list,
// they will be considered in the regular expression.
// If one compiler name is a substring of another, include it after in this list.
// todo: any other scenarios of aliases and symlinks
// that would make parseLineAsTool to not match the regular expression,
// therefore wrongly skipping over compilation lines?
const compilers: string[] = ["ccache", "clang\\+\\+", "clang-cl", "clang-cpp", "clang", "gcc", "gpp", "cpp", "icc", "cc", "icl", "cl", "g\\+\\+", "c\\+\\+"];
const linkers: string[] = ["ccache", "ilink", "link", "ld", "gcc", "clang\\+\\+", "clang", "cc", "g\\+\\+", "c\\+\\+"];
const sourceFileExtensions: string[] = ["cpp", "cc", "cxx", "c"];

const chunkSize: number = 100;

export async function parseTargets(cancel: vscode.CancellationToken, verboseLog: string,
                                   statusCallback: (message: string) => void,
                                   foundTargetCallback: (target: string) => void): Promise<number> {
    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

    // Extract the text between "# Files" and "# Finished Make data base" lines
    // There can be more than one matching section.
    let regexpExtract: RegExp = /(# Files\n*)([\s\S]*?)(# Finished Make data base)/mg;
    let result: RegExpExecArray | null;
    let extractedLog: string = "";

    let matches: string[] = [];
    let match: string[] | null;
    result = await util.scheduleTask(() => regexpExtract.exec(verboseLog));

    while (result) {
        extractedLog = result[2];

        // Skip lines starting with {#,.} or preceeded by "# Not a target" and extract the target.
        // Additionally, if makefile.phonyOnlyTargets is true, include only targets
        // succeeded by "#  Phony target (prerequisite of .PHONY).".
        let regexpTargetStr: string = "^(?!\\n?[#\\.])(?<!^\\n?# Not a target:\\s*)\\s*(\\S+[^:]):\\s+";
        if (configuration.getPhonyOnlyTargets()) {
         regexpTargetStr += ".*\\s+(?=#  Phony target \\(prerequisite of \\.PHONY\\)\\.)";
        }
        let regexpTarget: RegExp = RegExp(regexpTargetStr, "mg");

        match = regexpTarget.exec(extractedLog);

        if (match) {
            let done: boolean = false;
            let doParsingChunk: (() => void) = () => {
                let chunkIndex: number = 0;

                while (match && chunkIndex <= chunkSize) {
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
                        done = true;
                    }

                    chunkIndex++;
                }
            };
            while (!done) {
                if (cancel.isCancellationRequested) {
                    return make.ConfigureBuildReturnCodeTypes.cancelled;
                }

                await util.scheduleTask(doParsingChunk);
            }
        } // if match

        result = await util.scheduleTask(() => regexpExtract.exec(verboseLog));
    } // while result

    return cancel.isCancellationRequested ? make.ConfigureBuildReturnCodeTypes.cancelled : make.ConfigureBuildReturnCodeTypes.success;
}

export interface PreprocessDryRunOutputReturnType {
    retc: number;
    elapsed: number;
    result?: string;
}

// Make various preprocessing transformations on the dry-run output
// TODO: "cmd -c", "start cmd", "exit"
export async function preprocessDryRunOutput(cancel: vscode.CancellationToken, dryRunOutputStr: string,
                                             statusCallback: (message: string) => void): Promise<PreprocessDryRunOutputReturnType> {
    let preprocessedDryRunOutputStr: string = dryRunOutputStr;

    if (cancel.isCancellationRequested) {
        return {
            retc: make.ConfigureBuildReturnCodeTypes.cancelled,
            elapsed: 0
        };
    }

    let startTime: number = Date.now();
    statusCallback("Preprocessing the dry-run output");

    // Array of tasks required to be executed during the preprocess configure phase
    let preprocessTasks: (() => void)[] = [];

    // Expand {REPO:VSCODE-MAKEFILE-TOOLS} to the full path of the root of the extension
    // This is used for the pre-created dry-run logs consumed by the tests,
    // in order to be able to have source files and includes for the test repro
    // within the test subfolder of the extension repo, while still exercising full paths for parsing
    // and not generating a different output with every new location where Makefile Tools is enlisted.
    // A real user scenario wouldn't need this construct.
    preprocessTasks.push(function (): void {
        if (process.env['MAKEFILE_TOOLS_TESTING'] === '1') {
            let extensionRootPath: string = path.resolve(__dirname, "../../");
            preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
        }
    });

    // Sometimes the ending of lines ends up being a mix and match of \n and \r\n.
    // Make it uniform to \n to ease other processing later.
    preprocessTasks.push(function (): void {
        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/\\r\\n/mg, "\n");
    });

    // Some compiler/linker commands are split on multiple lines.
    // At the end of every intermediate line is at least a space, then a \ and end of line.
    // Concatenate all these lines to see clearly each command on one line.
    let regexp: RegExp = /\s+\\$\n/mg;
    preprocessTasks.push(function (): void {
        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(regexp, " ");
    });

    // In case we parse a build log (as opposed to a dryrun log) for a project using libtool,
    // capture the compiler commands reported by the libtool output.
    // They may be redundant with the corresponding line from the dryrun (which is present in the build log as well)
    // but in case of $ variables and commands invoked on the fly, the second time all are resolved/expanded
    // and we can actually send good IntelliSense information for a good source code URL.
    // For such a case, look at MONO (git clone https://github.com/mono/mono.git), for source code cordxtra.c
    // Line with the original command, containing a 'test' command to determine on the fly the source code path.
    // This line is present in the dryrun and also in the build log. Can't easily parse the correct source code path.
    // /bin/bash ./libtool  --tag=CC   --mode=compile gcc -DHAVE_CONFIG_H   -I./include -I./include  -DGC_PTHREAD_START_STANDALONE    -fexceptions -Wall -Wextra -Wpedantic -Wno-long-long -g -O2 -fno-strict-aliasing  -MT cord/libcord_la-cordxtra.lo -MD -MP -MF cord/.deps/libcord_la-cordxtra.Tpo -c -o cord/libcord_la-cordxtra.lo `test -f 'cord/cordxtra.c' || echo './'`cord/cordxtra.c
    // Line with the resolved command, from which the extension can parse a valid source code path.
    // This line is present only in the build log, immediately following the above line.
    // libtool: compile:  gcc -DHAVE_CONFIG_H -I./include -I./include -DGC_PTHREAD_START_STANDALONE -fexceptions -Wall -Wextra -Wpedantic -Wno-long-long -g -O2 -fno-strict-aliasing -MT cord/libcord_la-cordxtra.lo -MD -MP -MF cord/.deps/libcord_la-cordxtra.Tpo -c cord/cordxtra.c  -fPIC -DPIC -o cord/.libs/libcord_la-cordxtra.o
    preprocessTasks.push(function (): void {
        regexp = /libtool: compile:|libtool: link:/mg;
        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(regexp, "\nLIBTOOL_PATTERN\n");
    });

    // Process some more makefile output weirdness
    // When --mode=compile or --mode=link are present in a line, we can ignore anything that is before
    // and all that is after is a normal complete compiler or link command.
    // Replace these patterns with end of line so that the parser will see only the right half.
    preprocessTasks.push(function (): void {
        regexp = /--mode=compile|--mode=link/mg;
        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(regexp, "\nLIBTOOL_PATTERN\n");
    });

    // Remove lines with $() since they come from unexpanded yet variables. The extension can't do anything yet
    // about them anyway and also there will be a correspondent line in the dryrun with these variables expanded.
    // Don't remove lines with $ without paranthesis, there are valid compilation lines that would be ignored otherwise.
    preprocessTasks.push(function (): void {
      regexp = /.*\$\(.*/mg;
      preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(regexp, "");
    });

    // Extract the link command
    // Keep the /link switch to the cl command because otherwise we will see compiling without /c
    // and we will deduce some other output binary based on its /Fe or /Fo or first source given,
    // instead of the output binary defined via the link operation (which will be parsed on the next line).
    // TODO: address more accurately the overriding scenarios between output files defined via cl.exe
    // and output files defined via cl.exe /link.
    // For example, "cl.exe source.cpp /Fetest.exe /link /debug" still produces test.exe
    // but cl.exe source.cpp /Fetest.exe /link /out:test2.exe produces only test2.exe.
    // For now, ignore any output binary rules of cl while having the /link switch.
    preprocessTasks.push(function (): void {
        if (process.platform === "win32") {
            preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/ \/link /g, "/link \n link.exe ");
        }
    });

    // The splitting of multiple commands is better to be done at the end.
    // Oherwise, this scenario interferes with the line ending '\' in some cases
    // (see MAKE repo, ar.c compiler command, for example).
    // Split multiple commands concatenated by '&&'
    preprocessTasks.push(function (): void {
        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/ && /g, "\n");
    });

    // Split multiple commands concatenated by ";"
    preprocessTasks.push(function (): void {
        preprocessedDryRunOutputStr = preprocessedDryRunOutputStr.replace(/;/g, "\n");
    });

    // Loop through all the configure preprocess tasks, checking for cancel.
    for (const func of preprocessTasks) {
        await util.scheduleTask(func);

        if (cancel.isCancellationRequested) {
            return {
                retc: make.ConfigureBuildReturnCodeTypes.cancelled,
                elapsed: util.elapsedTimeSince(startTime)
            };
        }
    }

    return {
        retc: make.ConfigureBuildReturnCodeTypes.success,
        elapsed: util.elapsedTimeSince(startTime),
        result: preprocessedDryRunOutputStr
    };

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
async function parseLineAsTool(
    line: string,
    toolNames: string[],
    currentPath: string,
    isCompilerOrLinker: boolean = true
): Promise<ToolInvocation | undefined> {
    // To avoid hard-coding (and ever maintaining) in the tools list
    // the various compilers/linkers that can have versions, prefixes or suffixes
    // in their names, include a crafted regex around each tool name.
    // Any number of prefix or suffix text, separated by '-'.
    let versionedToolNames: string[] = [];
    const prefixRegex: string = isCompilerOrLinker ? "(([a-zA-Z0-9-_.]*-)*" : "";
    const suffixRegex: string = isCompilerOrLinker ? "(-[a-zA-Z0-9-_.]*)*)" : "";
    toolNames.forEach(tool => {
        // Check if the user defined this tool as to be excluded
        if (!configuration.getExcludeCompilerNames()?.includes(tool)) {
            versionedToolNames.push(`${prefixRegex}${tool}${suffixRegex}`);
        }
    });

    // Add any additional tools specified by the user
    configuration.getAdditionalCompilerNames()?.forEach(compiler => {
        if (!toolNames.includes(compiler)) {
            versionedToolNames.push(`${prefixRegex}${compiler}${suffixRegex}`);
        }
    });

    // - any spaces/tabs before the tool invocation
    // - with or without path (relative -to the makefile location- or full)
    // - with or without extension (windows only)
    // - with or without quotes
    // - must have at least one space or tab after the tool invocation
    let regexpStr: string = '^[\\s\\"]*(.*?)(';
    if (process.platform === "win32") {
        regexpStr += versionedToolNames.join('\\.exe|');

        // ensure to append the extension for the last tool in the array since join didn't.
        if (versionedToolNames.length > 0) {
            regexpStr += ('\\.exe');
        }

        regexpStr += '|';
    }

    regexpStr += versionedToolNames.join('|') + ')[\\s\\"]+(.*)$';

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

    // Quotes are not needed either for the compiler path or the current path.
    // checkFileExists works just fine without quotes,
    // but makeFullPath gets confused sometimes for some quotes scenarios.
    currentPath = util.removeQuotes(currentPath);
    toolPathInMakefile = toolPathInMakefile.trimLeft();
    toolPathInMakefile = util.removeQuotes(toolPathInMakefile);

    let toolFullPath: string = await util.makeFullPath(toolPathInMakefile + toolNameInMakefile, currentPath);
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
        arguments: match[match.length - 1],
        found: toolFound
    };
}

// Helper to identify anything that looks like a compiler switch in the given command string.
// The result is passed to IntelliSense custom configuration provider as compilerArgs.
// excludeArgs helps with narrowing down the search, when we know for sure that we're not
// interested in some switches. For example, -D, -I, -FI, -include, -std are treated separately.
function parseAnySwitchFromToolArguments(args: string, excludeArgs: string[]): string[] {
    // Identify the non value part of the switch: prefix, switch name
    // and what may separate this from an eventual switch value
    let switches: string[] = [];
    let regExpStr: string = "(^|\\s+)(--|-" +
                            // On Win32 allow '/' as switch prefix as well,
                            // otherwise it conflicts with path character
                            (process.platform === "win32" ? "|\\/" : "") +
                            ")([a-zA-Z0-9_]+)";
    let regexp: RegExp = RegExp(regExpStr, "mg");
    let match1: RegExpExecArray | null;
    let match2: RegExpExecArray | null;
    let index1: number = -1;
    let index2: number = -1;

    // With every loop iteration we need 2 switch matches so that we analyze the text
    // that is between them. If the current match is the last one, then we will analyze
    // everything until the end of line.
    match1 = regexp.exec(args);
    while (match1) {
        // Marks the beginning of the current switch (prefix + name).
        // The exact switch prefix is needed when we call other parser helpers later
        // and also CppTools expects the compiler arguments to be prefixed
        // when received from the custom providers.
        index1 = regexp.lastIndex - match1[0].length;

        // Marks the beginning of the next switch
        match2 = regexp.exec(args);
        if (match2) {
            index2 = regexp.lastIndex - match2[0].length;
        } else {
            index2 = args.length;
        }

        // The substring to analyze for the current switch.
        // It doesn't help to look beyond the next switch match.
        let partialArgs: string = args.substring(index1, index2);
        let swi: string = match1[3];
        swi = swi.trim();

        // Skip over any switches that we know we don't need
        let exclude: boolean = false;
        for (const arg of excludeArgs) {
            if (swi.startsWith(arg)) {
                exclude = true;
                break;
            }
        }

        if (!exclude) {
            // The other parser helpers differ from this one by the fact that they know
            // what switch they are looking for. This helper first identifies anything
            // that looks like a switch and then calls parseMultipleSwitchFromToolArguments
            // which knows how to parse complex scenarios of spaces, quotes and other characters.
            // Don't allow parseMultipleSwitchFromToolArguments to remove surrounding quotes for switch values.
            let swiValues: string[] = parseMultipleSwitchFromToolArguments(partialArgs, swi, false);

            // If no values are found, it means the switch has simple syntax.
            // Add this to the array.
            if (swiValues.length === 0) {
                swiValues.push(swi);
            }

            swiValues.forEach(value => {
                // The end of the current switch value
                let index3: number = partialArgs.indexOf(value) + value.length;
                let finalSwitch: string = partialArgs.substring(0, index3);

                finalSwitch = finalSwitch.trim();
                switches.push(finalSwitch);
            });
        }

        match1 = match2;
    }

    return switches;
}

// Helper that parses for a particular switch that can occur one or more times
// in the tool command line (example -I or -D for compiler)
// and returns an array of the values passed via that switch
// todo: refactor common parts in parseMultipleSwitchFromToolArguments and parseSingleSwitchFromToolArguments
// removeSurroundingQuotes: needs to be false when called from parseAnySwitchFromToolArguments,
// and true otherwise. We need to analyze more scenarios before setting in stone a particular algorithm
// regarding the decision to remove or not to remove them.
function parseMultipleSwitchFromToolArguments(args: string, sw: string, removeSurroundingQuotes: boolean = true): string[] {
    // - '-' or '/' or '--' as switch prefix
    // - before each switch, we allow only for one or more spaces/tabs OR begining of line,
    //   to reject a case where a part of a path looks like a switch with its value
    //    (example: "drive:/dir/Ifolder" taking /Ifolder as include switch).
    // - can be wrapped by a pair of ', before the switch prefix and after the switch value
    //    (example: '-DMY_DEFINE=SOMETHING' or '/I drive/folder/subfolder').
    // - one or none or more spaces/tabs or ':' or '=' between the switch and the value
    //    (examples): -Ipath, -I path, -I    path, -std=gnu89
    // - the value can be wrapped by a pair of ", ' or `, even simmetrical combinations ('"..."')
    //   and should be able to not stop at space when inside the quote characters.
    //    (examples): -D'MY_DEFINE', -D "MY_DEFINE=SOME_VALUE", -I`drive:/folder with space/subfolder`
    // - when the switch value contains a '=', the right half can be also quoted by ', ", ` or '"..."'
    //   and should be able to not stop at space when inside the quote characters.
    //    (example): -DMY_DEFINE='"SOME_VALUE"'

    function anythingBetweenQuotes(fullyQuoted: boolean): string {
        let anythingBetweenReverseQuote: string = '\\`[^\\`]*?\\`';
        let anythingBetweenSingleQuote: string = "\\'[^\\']*?\\'";
        let anythingBetweenDoubleQuote: string = '\\"[^\\"]*?\\"';

        // If the switch is fully quoted with ', like ('-DMY_DEFINE="MyValue"'), don't allow single quotes
        // inside the switch value.
        // One example of what can be broken if we don't do this: gcc '-DDEF1=' '-DDef2=val2'
        // in which case DEF1 would be seen as DEF1=' ' instead of empty =
        let str: string = anythingBetweenReverseQuote + '|' + anythingBetweenDoubleQuote + (fullyQuoted ? "" : '|' + anythingBetweenSingleQuote);
        return str;
    }

    function mainPattern(fullyQuoted: boolean): string {
        let pattern: string =
                            // prefix and switch name
                            '(' +
                                  '\\/' + sw + '(:|=|\\s*)|-' + sw + '(:|=|\\s*)|--' + sw + '(:|=|\\s*)' +
                            ')' +
                            // switch value
                            '(' +
                                anythingBetweenQuotes(fullyQuoted) + '|' +
                                // not fully quoted switch value scenarios
                                '(' +
                                    // the left side (or whole value if no '=' is following)
                                    '(' +
                                        '[^\\s=]+' + // not quoted switch value component
                                    ')' +
                                    '(' +
                                        '=' + // separator between switch value left side and right side
                                        '(' +
                                            anythingBetweenQuotes(fullyQuoted) + '|' +
                                            '[^\\s]+' +  // not quoted right side of switch value
                                                         // equal is actually allowed (example gcc switch: -fmacro-prefix-map=./= )
                                        ')?' + // right side of '=' is optional, meaning we can define as nothing, like: -DMyDefine=
                                    ')?' + // = is also optional (simple define)
                                ')' +
                            ')';

        return pattern;
    }

    let regexpStr: string = '(' + '^|\\s+' + ')' + // start of line or any amount of space character
                            '(' +
                                '(' + "\\'" + mainPattern(true) + "\\'" + ')' + "|" + // switch if fully quoted
                                '(' + mainPattern(false) + ')' + // switch if not fully quoted
                            ')';
    let regexp: RegExp = RegExp(regexpStr, "mg");
    let match: RegExpExecArray | null;
    let results: string[] = [];

    match = regexp.exec(args);
    while (match) {
        let matchIndex: number = (match[2].startsWith("'") && match[2].endsWith("'")) ? 8 : 18;
        let result: string = match[matchIndex];
        if (result) {
           if (removeSurroundingQuotes) {
              result = util.removeSurroundingQuotes(result);
           }
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
// TODO: review the regexp for parseMultipleSwitchFromToolArguments to make sure all new capabilities
// are reflected in the regexp here (especially around quoting scenarios and '=').
// For now it's not critical because parseMultipleSwitchesFromToolArguments is called for target
// architecture switches which don't have such complex scenarios.
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
// TODO: review the regexp for parseMultipleSwitchFromToolArguments to make sure all new capabilities
// are reflected in the regexp here (especially around quoting scenarios and '=').
// For now it's not critical because parseSingleSwitchFromToolArguments is called for switches
// that have simple value scenarios.
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

        // It is quite common to encounter the following pattern:
        //  `test -f 'sourceFile.c' || echo './'`sourceFile.c
        // or `test -f 'sourceFile.c' || echo '../../../libwally-core/src/'`sourceFile.c
        // Until we implement the correct approach (to query live the test command)
        // we can just ignore it and consider the second option of the OR
        // (by removing the quotes while preserving the relative path).
        // This is a short term workaround.
        let idx: number = args.lastIndexOf(result);
        let echo: string = "' || echo ";
        let str: string = args.substring(idx - echo.length, idx);
        if (str === echo) {
            // not to use util.removeQuotes because that also removes double quotes "
            result = result.replace(/\'/mg, "");
            result = result.replace(/\`/mg, "");
        }

        if (result) {
            result = util.removeSurroundingQuotes(result);

            // Debug message to identify easier the scenarios where source files have inner quotes.
            if (result.includes('"')) {
                logger.message(`File argument that contains quotes: \`${result}\``, "Debug");
            }

            files.push(result);
        }
        match = regexp.exec(args);
    }

    return files;
}

// Helper that identifies system commands (cd, cd -, pushd, popd) and make.exe change directory switch (-C)
// to calculate the effect on the current path, also remembering the transition in the history stack.
// The current path is always the last one into the history.
async function currentPathAfterCommand(line: string, currentPathHistory: string[]): Promise<string[]> {
    line = line.trimLeft();
    line = line.trimRight();

    let lastCurrentPath: string = (currentPathHistory.length > 0) ? currentPathHistory[currentPathHistory.length - 1] : "";
    let newCurrentPath: string = "";

    if (line.startsWith('cd -') && !configuration.getIgnoreDirectoryCommands()) {
        // Swap the last two current paths in the history.
        if (lastCurrentPath) {
            currentPathHistory.pop();
        }

        let lastCurrentPath2: string = (currentPathHistory.length > 0) ? currentPathHistory.pop() || "" : lastCurrentPath;

        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("CD- command: leaving directory " + lastCurrentPath + " and entering directory " + lastCurrentPath2, "Verbose");
        currentPathHistory.push(lastCurrentPath);
        currentPathHistory.push(lastCurrentPath2);
    } else if ((line.startsWith('popd') && !configuration.getIgnoreDirectoryCommands()) ||
               line.includes('Leaving directory')) {
        let lastCurrentPath: string = (currentPathHistory.length > 0) ? currentPathHistory[currentPathHistory.length - 1] : "";
        currentPathHistory.pop();
        let lastCurrentPath2: string = (currentPathHistory.length > 0) ? currentPathHistory[currentPathHistory.length - 1] : "";
        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("POPD command or end of MAKE -C: leaving directory " + lastCurrentPath + " and entering directory " + lastCurrentPath2, "Verbose");
    } else if (line.startsWith('cd') && !configuration.getIgnoreDirectoryCommands()) {
        newCurrentPath = await util.makeFullPath(line.slice(3), lastCurrentPath);

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
    } else if (line.startsWith('pushd') && !configuration.getIgnoreDirectoryCommands()) {
        newCurrentPath = await util.makeFullPath(line.slice(6), lastCurrentPath);
        currentPathHistory.push(newCurrentPath);
        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("PUSHD command: entering directory " + newCurrentPath, "Verbose");
    } else if (line.includes('Entering directory')) { // equivalent to pushd
        // The make switch print-directory wraps the folder in various ways.
        let match: RegExpMatchArray | null = line.match("(.*)(Entering directory ['`\"])(.*)['`\"]");
        if (match) {
            newCurrentPath = await util.makeFullPath(match[3], lastCurrentPath) || "";
        } else {
            newCurrentPath = "Could not parse directory";
        }

        logger.message("Analyzing line: " + line, "Verbose");
        logger.message("MAKE -C: entering directory " + newCurrentPath, "Verbose");
        currentPathHistory.push(newCurrentPath);
    }

    return currentPathHistory;
}

// Structure used to describe a compilation command. Reference documentation is
// hosted here https://clang.llvm.org/docs/JSONCompilationDatabase.html
export interface CompileCommand {
    directory: string;
    file: string;
    command: string;
    arguments?: string[];
    output?: string;
}

export interface CustomConfigProviderItem {
    defines: string[];
    includes: string[];
    forcedIncludes: string[];
    standard: util.StandardVersion;
    intelliSenseMode: util.IntelliSenseMode;
    compilerFullPath: string;
    compilerArgs: string[];
    files: string[];
    windowsSDKVersion?: string;
    currentPath: string;
    line: string;
}

// Parse the output of the make dry-run command in order to provide CppTools
// with information about includes, defines, compiler path....etc...
// as needed by CustomConfigurationProvider. In addition generate a
// CompileCommand entry for every file with a compiler invocation to build
// a compile_commands.json file.
export async function parseCustomConfigProvider(cancel: vscode.CancellationToken, dryRunOutputStr: string,
                                                statusCallback: (message: string) => void,
                                                onFoundCustomConfigProviderItem: (customConfigProviderItem: CustomConfigProviderItem) => void): Promise<number> {
    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

    logger.message('Parsing dry-run output for CppTools Custom Configuration Provider.', "Normal");

    // Current path starts with workspace root and can be modified
    // with prompt commands like cd, cd-, pushd/popd or with -C make switch
    let currentPath: string = vscode.workspace.rootPath || "";
    let currentPathHistory: string[] = [currentPath];

    // Read the dry-run output line by line, searching for compilers and directory changing commands
    // to construct information for the CppTools custom configuration
    let dryRunOutputLines: string[] = dryRunOutputStr.split("\n");
    let numberOfLines: number = dryRunOutputLines.length;
    let index: number = 0;
    let done: boolean = false;
    async function doParsingChunk(): Promise<void> {
        let chunkIndex: number = 0;
        while (index < numberOfLines && chunkIndex <= chunkSize) {
            if (cancel.isCancellationRequested) {
                break;
            }

            let line: string = dryRunOutputLines[index];

            statusCallback("Parsing for IntelliSense");
            currentPathHistory = await currentPathAfterCommand(line, currentPathHistory);
            currentPath = currentPathHistory[currentPathHistory.length - 1];

            let compilerTool: ToolInvocation | undefined = await parseLineAsTool(line, compilers, currentPath);
            if (compilerTool) {
                logger.message("Found compiler command: " + line, "Verbose");

                // Compiler path is either what the makefile provides or found in the PATH environment variable or empty
                let compilerFullPath: string = compilerTool.fullPath || "";
                if (!compilerTool.found) {
                    let toolBaseName: string = path.basename(compilerFullPath);
                    compilerFullPath = path.join(util.toolPathInEnv(toolBaseName) || "", toolBaseName);
                }

                // Exclude switches that are being processed separately (I, FI, include, D, std)
                // and switches that don't affect IntelliSense but are causing errors.
                let compilerArgs: string[] = [];
                compilerArgs = parseAnySwitchFromToolArguments(compilerTool.arguments, ["I", "FI", "include", "D", "std", "MF"]);

                // Parse and log the includes, forced includes and the defines
                let includes: string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'I');
                includes = await util.makeFullPaths(includes, currentPath);
                let forcedIncludes: string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'FI');
                forcedIncludes = forcedIncludes.concat(parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'include'));
                forcedIncludes = await util.makeFullPaths(forcedIncludes, currentPath);

                let defines: string[] = parseMultipleSwitchFromToolArguments(compilerTool.arguments, 'D');

                // Parse the IntelliSense mode
                // how to deal with aliases and symlinks (CC, C++), which can point to any toolsets
                let targetArchitecture: util.TargetArchitecture = getTargetArchitecture(compilerTool.arguments);
                let intelliSenseMode: util.IntelliSenseMode = getIntelliSenseMode(ext.extension.getCppToolsVersion(), compilerFullPath, targetArchitecture);

                // For windows, parse the sdk version
                let windowsSDKVersion: string | undefined = "";
                if (process.platform === "win32") {
                    windowsSDKVersion = process.env["WindowsSDKVersion"];
                }

                // Parse the source files
                let files: string[] = parseFilesFromToolArguments(compilerTool.arguments, sourceFileExtensions);
                files = await util.makeFullPaths(files, currentPath);

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

                    if (ext.extension) {
                        onFoundCustomConfigProviderItem({ defines, includes, forcedIncludes, standard, intelliSenseMode, compilerFullPath, compilerArgs, files, windowsSDKVersion, currentPath, line });
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

                        if (ext.extension) {
                            onFoundCustomConfigProviderItem({ defines, includes, forcedIncludes, standard, intelliSenseMode, compilerFullPath, compilerArgs, files: [file], windowsSDKVersion, currentPath, line });
                        }
                    });
                }
            } // if (compilerTool) {

            index++;
            if (index === numberOfLines) {
                done = true;
            }

            chunkIndex++;
        } // while loop
    } // doParsingChunk function

    while (!done) {
        if (cancel.isCancellationRequested) {
            break;
        }

        await util.scheduleAsyncTask(doParsingChunk);
    }

    return cancel.isCancellationRequested ? make.ConfigureBuildReturnCodeTypes.cancelled : make.ConfigureBuildReturnCodeTypes.success;
}

// Target binaries arguments special handling
function filterTargetBinaryArgs(args: string[]): string[] {
    let processedArgs: string[] = [];

    for (const arg of args) {
        // Once we encounter a redirection character (pipe, stdout/stderr) remove it,
        // together with all the arguments that are following,
        // since they are not real parameters of the binary tool that is analyzed.
        if (arg === '>' || arg === '1>' || arg === '2>' || arg === '|') {
            break;
        }

        processedArgs.push(arg);
    }

    return processedArgs;
}

// Parse the output of the make dry-run command in order to provide VS Code debugger
// with information about binaries, their execution paths and arguments
export async function parseLaunchConfigurations(cancel: vscode.CancellationToken, dryRunOutputStr: string,
                                                statusCallback: (message: string) => void,
                                                onFoundLaunchConfiguration: (launchConfiguration: configuration.LaunchConfiguration) => void): Promise<number> {
    if (cancel.isCancellationRequested) {
        return make.ConfigureBuildReturnCodeTypes.cancelled;
    }

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
    let done: boolean = false;
    let doLinkCommandsParsingChunk: (() => Promise<void>) = async () => {
        let chunkIndex: number = 0;
        while (index < numberOfLines && chunkIndex <= chunkSize) {
            if (cancel.isCancellationRequested) {
                break;
            }

            let line: string = dryRunOutputLines[index];

            statusCallback("Parsing for launch targets: inspecting for link commands");
            currentPathHistory = await currentPathAfterCommand(line, currentPathHistory);
            currentPath = currentPathHistory[currentPathHistory.length - 1];

            // A target binary is usually produced by the linker with the /out or /o switch,
            // but there are several scenarios (for win32 Microsoft cl.exe)
            // when the compiler is producing an output binary directly (via the /Fe switch)
            // or indirectly (based on some naming default rules in the absence of /Fe)
            let linkerTargetBinary: string | undefined;
            let compilerTargetBinary: string | undefined;

            if (process.platform === "win32") {
                let compilerTool: ToolInvocation | undefined = await parseLineAsTool(line, compilers, currentPath);
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
                        compilerTargetBinary = await util.makeFullPath(compilerTargetBinary, currentPath);
                    }
                }
            }

            let linkerTool: ToolInvocation | undefined = await parseLineAsTool(line, linkers, currentPath);
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
                        }
                    }

                    if (linkerTargetBinary) {
                        // Until we implement a more robust link target analysis
                        // (like query-ing for the executable attributes),
                        // we can safely assume that a ".la" file produced by libtool
                        // is a library and not an executable binary.
                        if (linkerTargetBinary.endsWith(".la") && dryRunOutputLines[index - 1] === "LIBTOOL_PATTERN") {
                            linkerTargetBinary = undefined;
                        } else {
                            linkerTargetBinary = util.removeSurroundingQuotes(linkerTargetBinary);
                            logger.message("Producing target binary: " + linkerTargetBinary, "Verbose");
                            linkerTargetBinary = await util.makeFullPath(linkerTargetBinary, currentPath);
                        }
                    }
                }
            }

            // It is not possible to have compilerTargetBinary and linkerTargetBinary both defined,
            // because a dry-run output line cannot be a compilation and an explicit link at the same time.
            // (cl.exe with /link switch is split into two lines - cl.exe and link.exe - during dry-run preprocessing).
            // Also for gcc/clang, -o switch or the default output will be a .o in the presence of -c and an executable otherwise.
            let targetBinary: string | undefined = linkerTargetBinary || compilerTargetBinary;

            // Some "$" (without following open paranthesis) are still left in the preprocessed output,
            // because the configuraion provider parser may lose valid compilation lines otherwise.
            // Additionally, for linker commands, ignore any dollar if present in the target binary name.
            // We need to ignore the $ anywhere else in the linker command line so that we don't lose
            // valid target binaries.
            if (targetBinary && !targetBinary.includes("$")) {
                targetBinaries.push(targetBinary);

                // Include limited launch configuration, when only the binary is known,
                // in which case the execution path is defaulting to binary containing folder.
                // It is more likely that an invocation would succeed from that location
                // as opposed from any other (like the root) because of eventual dependencies
                // that very likely to be built in the same place.
                // and there are no args.
                let launchConfiguration: configuration.LaunchConfiguration = {
                    binaryPath: targetBinary,
                    cwd: path.parse(targetBinary).dir,
                    binaryArgs: []
                };

                logger.message("Adding launch configuration:\n" + configuration.launchConfigurationToString(launchConfiguration), "Verbose");
                onFoundLaunchConfiguration(launchConfiguration);
            }

            index++;
            if (index === numberOfLines) {
                done = true;
            }

            chunkIndex++;
        } // while loop
    }; // doLinkCommandsParsingChunk function

    while (!done) {
        if (cancel.isCancellationRequested) {
            return make.ConfigureBuildReturnCodeTypes.cancelled;
        }

        await util.scheduleAsyncTask(doLinkCommandsParsingChunk);
    }

    // If no binaries are found to be built, there is no point in parsing for invoking targets
    if (targetBinaries.length === 0) {
        return cancel.isCancellationRequested ? make.ConfigureBuildReturnCodeTypes.cancelled : make.ConfigureBuildReturnCodeTypes.success;
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

    // Since an executable can be called without its extension,
    // on Windows only and only for extensions 'exe',
    // create a new array with target binaries names
    // to ensure we parse right these binaries invocation right.
    let targetBinariesNames: string[] = [];
    targetBinaries.forEach(target => {
        let parsedPath: path.ParsedPath = path.parse(target);
        if (!targetBinariesNames.includes(parsedPath.name)) {
            if (process.platform === "win32" && parsedPath.ext === "exe") {
                targetBinariesNames.push(util.escapeString(parsedPath.name));
            } else {
                targetBinariesNames.push(util.escapeString(parsedPath.base));
            }
        }
    });

    index = 0;
    done = false;
    let doBinaryInvocationsParsingChunk: (() => Promise<void>) = async () => {
        let chunkIndex: number = 0;
        while (index < numberOfLines && chunkIndex <= chunkSize) {
            if (cancel.isCancellationRequested) {
                break;
            }

            let line: string = dryRunOutputLines[index];
            // Some "$" (without following open paranthesis) are still left in the preprocessed output,
            // because the configuraion provider parser may lose valid compilation lines otherwise.
            // But the binary invocations parser should ignore any dollar because the extension can't resolve
            // these anyway, wherever they are (current folder, binary name or arguments).
            if (!line.includes("$")) {
                statusCallback("Parsing for launch targets: inspecting built binary invocations");
                currentPathHistory = await currentPathAfterCommand(line, currentPathHistory);
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
                let targetBinaryTool: ToolInvocation | undefined = await parseLineAsTool(line, targetBinariesNames, currentPath);

                // If the found target binary invocation does not happen from a location
                // where it was built previously, don't include it as a launch target.
                // We can debug only what was built. Also, it's quite common to run
                // tools from the path during the build and we shouldn't launch those.
                if (targetBinaryTool) {
                    let foundTargetBinary: boolean = false;
                    targetBinaries.forEach(target => {
                        if (target === targetBinaryTool?.fullPath) {
                            foundTargetBinary = true;
                        }
                    });

                    if (!foundTargetBinary) {
                        targetBinaryTool = undefined;
                    }
                }

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
            }

            index++;
            if (index === numberOfLines) {
                done = true;
            }

            chunkIndex++;
        } // while loop
    }; // doBinaryInvocationsParsingChunk function

    while (!done) {
        if (cancel.isCancellationRequested) {
            break;
        }

        await util.scheduleAsyncTask(doBinaryInvocationsParsingChunk);
    }

    return cancel.isCancellationRequested ? make.ConfigureBuildReturnCodeTypes.cancelled : make.ConfigureBuildReturnCodeTypes.success;
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
            logger.message(`Unknown C++ standard control flag: ${std}`, "Normal");
        }
    } else if (language === "c") {
        standard = parseCStandard(std, canUseGnu);
        if (!standard) {
            logger.message(`Unknown C standard control flag: ${std}`, "Normal");
        }
    } else if (language === undefined) {
        standard = parseCppStandard(std, canUseGnu);
        if (!standard) {
            standard = parseCStandard(std, canUseGnu);
        }
        if (!standard) {
            logger.message(`Unknown standard control flag: ${std}`, "Normal");
        }
    } else {
        logger.message("Unknown language", "Normal");
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

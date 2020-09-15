// Helper APIs used by this extension

import * as fs from 'fs';
import * as child_process from 'child_process';
import * as configuration from './configuration';
import * as logger from './logger';
import * as make from './make';
import * as path from 'path';
import * as vscode from 'vscode';

// C/CPP standard versions
export type StandardVersion = 'c89' | 'c99' | 'c11' | 'c18' | 'c++98' | 'c++03' | 'c++11' | 'c++14' | 'c++17' | 'c++20' |
                              'gnu89' | 'gnu99' | 'gnu11' | 'gnu18' | 'gnu++98' | 'gnu++03' | 'gnu++11' | 'gnu++14' | 'gnu++17' | 'gnu++20' | undefined;

// Supported target architectures (for code generated by the compiler)
export type TargetArchitecture = 'x86' | 'x64' | 'arm' | 'arm64' | undefined;

// IntelliSense modes
export type IntelliSenseMode = "msvc-x64" | "msvc-x86" | "msvc-arm" | "msvc-arm64" |
                               "gcc-x64" | "gcc-x86" | "gcc-arm" | "gcc-arm64" |
                               "clang-x64" | "clang-x86" | "clang-arm" | "clang-arm64";

// Language types
export type Language = "c" | "cpp" | undefined;

export function checkFileExistsSync(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch (e) {
    }
    return false;
}

export function checkDirectoryExistsSync(directoryPath: string): boolean {
    try {
        return fs.statSync(directoryPath).isDirectory();
    } catch (e) {
    }
    return false;
}

export function deleteFileSync(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch (e) {
    }
}

export function readFile(filePath: string): string | undefined {
    try {
        if (checkFileExistsSync(filePath)) {
            return fs.readFileSync(filePath).toString();
        }
    } catch (e) {
    }

    return undefined;
}

export function writeFile(filePath: string, content: string): string | undefined {
    try {
        fs.writeFileSync(filePath, content);
    } catch (e) {
    }

    return undefined;
}

// Get the platform-specific temporary directory
export function tmpDir(): string {
    if (process.platform === 'win32') {
        return process.env['TEMP'] || "";
    } else {
        return '/tmp';
    }
}

// Evaluate whether a string looks like a path or not,
// without using fs.stat, since dry-run may output tools
// that are not found yet at certain locations,
// without running the prep targets that would copy them there
export function looksLikePath(pathStr: string): boolean {
    // TODO: to be implemented
    return true;
}

// Evaluate whether the tool is invoked from the current directory
export function pathIsCurrentDirectory(pathStr: string): boolean {
    // Ignore any spaces or tabs before the invocation
    pathStr = pathStr.trimLeft();

    if (pathStr === "") {
        return true;
    }

    if (process.platform === "win32" && process.env.MSYSTEM === undefined) {
        if (pathStr === ".\\") {
            return true;
        }
    } else {
        if (pathStr === "./") {
            return true;
        }
    }

    return false;
}

// Helper that searches for a tool in all the paths forming the PATH environment variable
// Returns the first one found or undefined if not found.
// TODO: implement a variation of this helper that scans on disk for the tools installed,
// to help when VSCode is not launched from the proper environment
export function toolPathInEnv(name: string): string | undefined {
    let envPath: string | undefined = process.env["PATH"];
    let envPathSplit: string[] = [];
    if (envPath) {
        envPathSplit = envPath.split(path.delimiter);
    }

    // todo: if the compiler is not found in path, scan on disk and point the user to all the options
    // (the concept of kit for cmake extension)

    return envPathSplit.find(p => {
        let fullPath: string = path.join(p, path.basename(name));
        if (checkFileExistsSync(fullPath)) {
            return fullPath;
        }
    });
}

function taskKill(pid: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        child_process.exec(`taskkill /pid ${pid} /T /F`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

export async function killTree(progress: vscode.Progress<{}>, pid: number): Promise<void> {
    if (process.platform === 'win32') {
        try {
            await taskKill(pid);
        } catch (e) {
            logger.message(`Failed to kill process ${pid}: ${e}`);
        }
        return;
    }

    let children: number[] = [];
    let stdoutStr: string = "";

    let stdout: any = (result: string): void => {
        stdoutStr += result;
    };

    try {
        const result: SpawnProcessResult = await spawnChildProcess('pgrep', ['-P', pid.toString()], vscode.workspace.rootPath || "", stdout);
        if (!!stdoutStr.length) {
            children = stdoutStr.split('\n').map((line: string) => Number.parseInt(line));

            logger.message(`Found children subprocesses: ${stdoutStr}.`);
            for (const other of children) {
                if (other) {
                    await killTree(progress, other);
                }
            }
        }
    } catch (e) {
        logger.message(e.message);
        throw e;
    }

    try {
        logger.message(`Killing process PID = ${pid}`);
        progress.report({ increment: 1, message: `Terminating process PID=${pid} ...` });
        process.kill(pid, 'SIGINT');
    } catch (e) {
        if (e.code !== 'ESRCH') {
            throw e;
        }
    }
}

export interface SpawnProcessResult {
    returnCode: number;
    signal: string;
}

// Helper to spawn a child process, hooked to callbacks that are processing stdout/stderr
export function spawnChildProcess(
    process: string,
    args: string[],
    workingDirectory: string,
    stdoutCallback?: (stdout: string) => void,
    stderrCallback?: (stderr: string) => void): Promise<SpawnProcessResult> {

    return new Promise<SpawnProcessResult>((resolve, reject) => {
        const child: child_process.ChildProcess = child_process.spawn(`"${process}"`, args, { cwd: workingDirectory, shell: true });
        make.setCurPID(child.pid);

        if (stdoutCallback) {
            child.stdout.on('data', (data) => {
                stdoutCallback(`${data}`);
            });
        }

        if (stderrCallback) {
            child.stderr.on('data', (data) => {
                stderrCallback(`${data}`);
            });
        }

        child.on('close', (returnCode: number, signal: string) => {
            resolve({returnCode, signal});
        });

        child.on('exit', (returnCode: number) => {
            resolve({returnCode, signal: ""});
        });

        if (child.pid === undefined) {
            reject(new Error(`Failed to spawn process: ${process} ${args}`));
        }
    });
}

// Helper to eliminate empty items in an array
export function dropNulls<T>(items: (T | null | undefined)[]): T[] {
    return items.filter(item => (item !== null && item !== undefined)) as T[];
}

// Helper to reinterpret one relative path (to the given current path) printed by make as full path
export function makeFullPath(relPath: string, curPath: string | undefined): string {
    let fullPath: string = relPath;

    if (!path.isAbsolute(fullPath) && curPath) {
        fullPath = path.join(curPath, relPath);
    }

    return fullPath;
}

// Helper to reinterpret the relative paths (to the given current path) printed by make as full paths
export function makeFullPaths(relPaths: string[], curPath: string | undefined): string[] {
    let fullPaths: string[] = [];

    relPaths.forEach(p => {
        fullPaths.push(makeFullPath(p, curPath));
    });

    return fullPaths;
}

export function formatMingW(path : string) : string {
    //path = path.replace(/\//g, '\\');
    path = path.replace(/\\/g, '/');
    path = path.replace(':', '');

    if (!path.startsWith('\\') && !path.startsWith('/')) {
        //path = '\\' + path;
        path = '/' + path;
    }

    return path;
}
// Helper to reinterpret one full path as relative to the given current path
export function makeRelPath(fullPath: string, curPath: string | undefined): string {
    let relPath: string = fullPath;

    if (path.isAbsolute(fullPath) && curPath) {
        // Tricky path formatting for mingw (and possibly other subsystems - cygwin?, ...),
        // causing the relative path calculation to be wrong.
        // For process.platform "win32", an undefined process.env.MSYSTEM guarantees pure windows
        // and no formatting is necessary.
        if (process.platform === "win32" && process.env.MSYSTEM !== undefined) {
            fullPath = formatMingW(fullPath);

            if (path.isAbsolute(curPath)) {
                curPath = formatMingW(curPath);
            }
        }

        relPath = path.relative(curPath, fullPath);
    }

    return relPath;
}

// Helper to reinterpret the relative paths (to the given current path) printed by make as full paths
export function makeRelPaths(fullPaths: string[], curPath: string | undefined): string[] {
    let relPaths: string[] = [];

    fullPaths.forEach(p => {
        relPaths.push(makeRelPath(p, curPath));
    });

    return fullPaths;
}

// Helper to remove any " or ' from the middle of a path
// because many file operations don't work properly with paths
// having quotes in the middle.
// Don't add here a pair of quotes surrounding the whole result string,
// this will be done when needed at other call sites.
export function removeQuotes(str: string): string {
    if (str.includes('"')) {
        str = str.replace(/"/g, "");
    }

    if (str.includes("'")) {
        str = str.replace(/'/g, "");
    }

    return str;
}

// Helper to evaluate whether two settings (objects or simple types) represent the same content.
// It recursively analyzes any inner subobjects and is also not affected
// by a different order of properties.
export function areEqual(setting1: any, setting2: any): boolean {
    if (setting1 === null || setting1 === undefined ||
        setting2 === null || setting2 === undefined) {
        return setting1 === setting2;
    }

    // This is simply type
    if (typeof (setting1) !== "function" && typeof (setting1) !== "object" &&
        typeof (setting2) !== "function" && typeof (setting2) !== "object") {
        return setting1 === setting2;
    }

    let properties1: string[] = Object.getOwnPropertyNames(setting1);
    let properties2: string[] = Object.getOwnPropertyNames(setting2);

    if (properties1.length !== properties2.length) {
        return false;
    }

    for (let p: number = 0; p < properties1.length; p++) {
        let property: string = properties1[p];
        let isEqual: boolean;
        if (typeof(setting1[property]) === 'object' && typeof(setting2[property]) === 'object') {
            isEqual = areEqual(setting1[property], setting2[property]);
        } else {
            isEqual = (setting1[property] === setting2[property]);
        }

        if (!isEqual) {
            return false;
        }
    }

    return true;
}

// Answers whether the given object has at least one property.
export function hasProperties(obj: any): boolean {
    if (obj === null || obj === undefined) {
        return false;
    }

    let props: string[] = Object.getOwnPropertyNames(obj);
    return props && props.length > 0;
}

// Apply any properties from source to destination, logging for overwrite.
// To make things simpler for the caller, create a valid dst if given null or undefined.
export function mergeProperties(dst: any, src: any): any {
    let props: string[] = src ? Object.getOwnPropertyNames(src) : [];
    props.forEach(prop => {
        if (!dst) {
            dst = {};
        }

        if (dst[prop] !== undefined) {
            logger.message(`Destination object already has property ${prop} set to ${dst[prop]}. Overwriting from source with ${src[prop]}`, "Debug");
        }

        dst[prop] = src[prop];
    });

    return dst;
}

export function reportDryRunError(): void {
    logger.message(`You can see the detailed dry-run output at ${configuration.getConfigurationCache()}`);
    logger.message("Make sure that the extension is invoking the same make command as in your development prompt environment.");
    logger.message("You may need to define or tweak a custom makefile configuration in settings via 'makefile.configurations' like described here: [link]");
    logger.message("Also make sure your code base does not have any known issues with the dry-run switches used by this extension (makefile.dryrunSwitches).");
    logger.message("If you are not able to fix the dry-run, open a GitHub issue in Makefile Tools repo: "
        + "https://github.com/microsoft/vscode-makefile-tools/issues");
}

// Helper to make paths absolute until the extension handles variables expansion.
export function resolvePathToRoot(relPath: string): string {
    if (!path.isAbsolute(relPath)) {
        return path.join(vscode.workspace.rootPath || "", relPath);
    }

    return relPath;
}

// Schedule a task to be run at some future time. This allows other pending tasks to
// execute ahead of the scheduled task and provides a form of async behavior for TypeScript.
export function scheduleTask2<T>(task: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        setImmediate(() => {
            try {
                const result: T = task();
                resolve(result);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function thisExtension(): vscode.Extension<any> {
    const ext: vscode.Extension<any> | undefined = vscode.extensions.getExtension('ms-vscode.makefile-tools');
    if (!ext) {
      throw new Error("Our own extension is null.");
    }

    return ext;
}

export interface PackageJSON {
    name: string;
    publisher: string;
    version: string;
    contributes: any;
}

export function thisExtensionPackage(): PackageJSON {
    const pkg: PackageJSON = thisExtension().packageJSON as PackageJSON;

    return {
      name: pkg.name,
      publisher: pkg.publisher,
      version: pkg.version,
      contributes: pkg.contributes
    };
}

export function thisExtensionPath(): string { return thisExtension().extensionPath; }

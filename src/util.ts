import * as fs from 'fs';
import * as child_process from 'child_process';
import * as path from 'path';

// TODO: c++20, c++latest
export type StandardVersion = 'c89' | 'c99' | 'c11' | 'c++98' | 'c++03' | 'c++11' | 'c++14' | 'c++17';
export type IntelliSenseMode = "msvc-x64" | "gcc-x64" | "clang-x64";

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

    if (process.platform === "win32") {
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
    let toolPath: string | undefined;

    let envPath: string | undefined = process.env["PATH"];
    let envPathSplit: string[] = [];
    if (envPath) {
        envPathSplit = envPath.split(path.delimiter);
    }

    envPathSplit.forEach(p => {
        let fullPath: string = path.join(p, path.basename(name));
        if (checkFileExistsSync(fullPath)) {
            toolPath = fullPath;
            return;
        }
    });

    return toolPath;

    // todo: if the compiler is not found in path, scan on disk and point the user to all the options
    // (the concept of kit for cmake extension)
}

// Helper to spawn a child process, hooked to callbacks that are processing stdout/stderr
export function spawnChildProcess(process: string, args: string[], workingDirectory: string,
    stdoutCallback: (stdout: string) => void,
    stderrCallback: (stderr: string) => void,
    closingCallback: (retc: number, signal: string) => void): Promise<void> {

    return new Promise<void>(function (resolve, reject): void {
        const child: child_process.ChildProcess = child_process.spawn(process, args, { cwd: workingDirectory });

        child.stdout.on('data', (data) => {
            stdoutCallback(`${data}`);
        });

        child.stderr.on('data', (data) => {
            stderrCallback(`${data}`);
        });

        child.on('close', (retCode: number, signal: string) => {
            closingCallback(retCode, signal);
        });

        if (child.pid === undefined) {
            throw new Error("PID undefined");
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

// Helper to reinterpret one full path as relative to the given current path
export function makeRelPath(fullPath: string, curPath: string | undefined): string {
    let relPath: string = fullPath;

    if (path.isAbsolute(relPath) && curPath) {
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
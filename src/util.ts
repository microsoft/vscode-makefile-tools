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

// Helper to reinterpret the relative paths (to the workspace folder) printed by make as full paths
export function makeFullPath(relPath: string, curPath: string | undefined): string {
    let fullPath: string = relPath;

    if (!path.isAbsolute(fullPath) && curPath) {
        fullPath = path.join(curPath, relPath);
    }

    return fullPath;
}


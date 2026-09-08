const { execFile, spawn }: typeof import("child_process") = require("node:child_process");
const fs: typeof import("fs") = require("node:fs");
const { promisify }: typeof import("util") = require("node:util");

export const execFileAsync = promisify(execFile);

export function spawnDetached(file: string, args: string[], logFile?: string): Promise<import("child_process").ChildProcess> {
    return new Promise((resolve, reject) => {
        let log: number | undefined;
        try {
            if (logFile) {
                // Replace the file so older sessions cannot write into the latest log.
                try {
                    fs.rmSync(logFile, { force: true });
                    log = fs.openSync(logFile, "w", 0o600);
                } catch (error) {
                    console.warn(`Could not open process log ${logFile}`, error);
                }
            }
            const child = spawn(file, args, { detached: true, stdio: ["ignore", log ?? "ignore", log ?? "ignore"] });
            child.once("error", reject);
            child.once("spawn", () => {
                child.unref();
                resolve(child);
            });
        } finally {
            if (log !== undefined) fs.closeSync(log);
        }
    });
}

export function stringifyExecFile(file: string, args: string[]): string {
    let result = `${file}`;
    for (const arg of args) {
        result += `  ${escapeString(arg)}`;
    }
    return result;
}

function escapeString(str: string): string {
    let fixed_string = "";
    let index = 0;
    let safe = /^[a-zA-Z0-9,._+:@%/-]$/;
    while (index < str.length) {
        let char = str[index];
        if (safe.exec(char) == null) {
            fixed_string += "\\";
        }
        fixed_string += char;
        index++;
    }
    return fixed_string;
}

type EnvMap = {
    [key: string]: string;
};

export function concatEnv(a: EnvMap, b?: EnvMap) {
    if (b !== undefined) {
        for (const key of Object.keys(b)) {
            a[key] = b[key];
        }
    }
    return a;
}

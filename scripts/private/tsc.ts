import ChildProcess from "child_process";
import Chalk from "chalk";
import Path from "path";
import { fileURLToPath } from "url";

const __dirname = Path.dirname(fileURLToPath(import.meta.url));
const typescriptCli = Path.join(__dirname, "..", "..", "node_modules", "typescript", "bin", "tsc");

export default function compile(directory) {
    return new Promise<void>((resolve, reject) => {
        const tscProcess = ChildProcess.execFile(process.execPath, [typescriptCli], { cwd: directory });

        tscProcess.stdout!.on("data", data =>
            process.stdout.write(Chalk.yellowBright(`[tsc] `) + Chalk.white(data.toString())),
        );

        tscProcess.stderr!.on("data", data =>
            process.stderr.write(Chalk.yellowBright(`[tsc] `) + Chalk.white(data.toString())),
        );

        tscProcess.on("error", reject);

        tscProcess.on("exit", exitCode => {
            if (exitCode !== 0) {
                reject(new Error(`TypeScript exited with code ${exitCode ?? "unknown"}`));
            } else {
                resolve();
            }
        });
    });
}

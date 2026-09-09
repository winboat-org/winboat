process.env.NODE_ENV = "development";

import * as Vite from "vite";
import ChildProcess, { type ChildProcessWithoutNullStreams } from "child_process";
import Path from "path";
import Chalk from "chalk";
import Chokidar from "chokidar";
import Electron from "electron";
import compileTs from "./private/tsc.ts";
import { prepareFreeRDP } from "./prepare-freerdp.mjs";
// ^ Extension needed because no TSConfig in the root
import FileSystem from "fs";
import { EOL } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);

let viteServer: Vite.ViteDevServer | null = null;
let electronProcess: ChildProcessWithoutNullStreams | null = null;
let electronProcessLocker = false;
let rendererPort = 0;

async function startRenderer() {
    viteServer = await Vite.createServer({
        configFile: Path.join(__dirname, "..", "vite.config.ts"),
        mode: "development",
    });

    return viteServer.listen();
}

async function startElectron() {
    if (electronProcess) {
        // single instance lock
        return;
    }

    try {
        await compileTs(Path.join(__dirname, "..", "src", "main"));
    } catch {
        console.log(Chalk.redBright("Could not start Electron because of the above typescript error(s)."));
        electronProcessLocker = false;
        return;
    }

    const args = [Path.join(__dirname, "..", "build", "main", "main.js"), String(rendererPort), ...process.argv.slice(2)];

    electronProcess = ChildProcess.spawn(String(Electron), args);
    electronProcessLocker = false;

    electronProcess!.stdout.on("data", data => {
        if (data == EOL) {
            return;
        }

        process.stdout.write(Chalk.blueBright(`[electron] `) + Chalk.white(data.toString()));
    });

    electronProcess!.stderr.on("data", data =>
        process.stderr.write(Chalk.blueBright(`[electron] `) + Chalk.white(data.toString())),
    );

    electronProcess!.on("exit", () => stop());
}

function restartElectron() {
    if (electronProcess) {
        electronProcess.removeAllListeners("exit");
        electronProcess.kill();
        electronProcess = null;
    }

    if (!electronProcessLocker) {
        electronProcessLocker = true;
        startElectron();
    }
}

function copyStaticFiles() {
    copy("static");
}

/*
The working dir of Electron is build/main instead of src/main because of TS.
tsc does not copy static files, so copy them over manually for dev server.
*/
function copy(path) {
    FileSystem.cpSync(
        Path.join(__dirname, "..", "src", "main", path),
        Path.join(__dirname, "..", "build", "main", path),
        { recursive: true },
    );
}

function stop() {
    viteServer!.close();
    process.exit();
}

async function start() {
    console.log(`${Chalk.greenBright("=======================================")}`);
    console.log(`${Chalk.greenBright("Starting Electron + Vite Dev Server...")}`);
    console.log(`${Chalk.greenBright("=======================================")}`);

    await prepareFreeRDP();
    const devServer = await startRenderer();
    rendererPort = devServer.config.server.port;

    copyStaticFiles();
    startElectron();

    const path = Path.join(__dirname, "..", "src", "main");
    Chokidar.watch(path, {
        cwd: path,
    }).on("change", path => {
        console.log(Chalk.blueBright(`[electron] `) + `Change in ${path}. reloading... 🚀`);

        if (path.startsWith(Path.join("static", "/"))) {
            copy(path);
        }

        restartElectron();
    });
}

start().catch(error => {
    console.error(Chalk.redBright("Could not start WinBoat:"), error);
    process.exitCode = 1;
});

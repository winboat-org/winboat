import { execFileAsync, spawnDetached, stringifyExecFile } from "../lib/exec-helper";
import { FREERDP_LOG_FILE } from "../lib/constants";
import { getBundledFreeRDPPath } from "../lib/electron";

export class FreeRDPInstallation {
    file: string;
    defaultArgs: string[];

    constructor(file: string, defaultArgs: string[] = []) {
        this.file = file;
        this.defaultArgs = defaultArgs;
    }

    exec(args: string[]): Promise<{
        stdout: string;
        stderr: string;
    }> {
        return execFileAsync(this.file, this.defaultArgs.concat(args), { timeout: 5000 });
    }

    stringifyExec(args: string[]): string {
        return stringifyExecFile(this.file, this.defaultArgs.concat(args));
    }

    launch(args: string[]) {
        return spawnDetached(this.file, this.defaultArgs.concat(args), FREERDP_LOG_FILE);
    }
}

const freeRDPInstallations = [
    new FreeRDPInstallation("xfreerdp3"),
    new FreeRDPInstallation("xfreerdp"),
    new FreeRDPInstallation("flatpak", ["run", "--command=xfreerdp", "com.freerdp.FreeRDP"]),
];

/**
 * Returns the correct FreeRDP 3.x.x command available on the system or null
 */
export async function getSystemFreeRDP() {
    const VERSION_3_STRING = "version 3.";
    for (let installation of freeRDPInstallations) {
        try {
            const shellOutput = await installation.exec(["--version"]);
            if (shellOutput.stdout.includes(VERSION_3_STRING)) {
                return installation;
            }
        } catch {}
    }
    return null;
}

/** Use the bundled client unless a compatible system client was explicitly selected. */
export async function getFreeRDP(useSystemFreeRDP = false): Promise<FreeRDPInstallation | null> {
    if (useSystemFreeRDP) {
        const system = await getSystemFreeRDP();
        if (system) return system;
        console.warn("The selected system FreeRDP is unavailable; using WinBoat's bundled client.");
    }

    try {
        // Enable the fork's reconnect/resume handling only for our bundled client.
        const bundled = new FreeRDPInstallation(await getBundledFreeRDPPath(), ["+auto-reconnect"]);
        const { stdout } = await bundled.exec(["/version"]);
        if (stdout.includes("version 3.")) return bundled;
    } catch (error) {
        console.error("WinBoat's bundled FreeRDP could not be started:", error);
    }
    return null;
}

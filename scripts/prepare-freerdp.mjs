import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";
import Path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { winboatFreeRDP } from "./freerdp-release.mjs";

const projectDirectory = Path.dirname(Path.dirname(fileURLToPath(import.meta.url)));
export const freeRDPDirectory = Path.join(projectDirectory, ".cache", "freerdp", "linux-x64", "wbfreerdp");
const execFileAsync = promisify(execFile);

async function sha256(file) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

export async function verifyFreeRDP(directory) {
    const executable = Path.join(directory, "xfreerdp");
    if ((await sha256(executable)) !== winboatFreeRDP.executableSha256) {
        throw new Error(`WBFreeRDP executable checksum mismatch: ${executable}`);
    }
    await access(executable, constants.X_OK);
    const manifest = JSON.parse(await readFile(Path.join(directory, "manifest.json"), "utf8"));
    if (manifest.executableSha256 !== winboatFreeRDP.executableSha256 || manifest.architecture !== "x64") {
        throw new Error("WBFreeRDP manifest does not match the pinned release.");
    }
    await access(Path.join(directory, "licenses", "FreeRDP", "LICENSE"));
    await access(Path.join(directory, "SOURCES.md"));
    const { stdout } = await execFileAsync(executable, ["/version"], { timeout: 5000 });
    if (!stdout.includes("version 3.30.")) throw new Error("WBFreeRDP could not report its expected version.");
}

export async function prepareFreeRDP() {
    if (process.platform !== "linux" || process.arch !== "x64") {
        throw new Error("The bundled WinBoat FreeRDP currently supports Linux x64 only.");
    }
    const cache = Path.dirname(freeRDPDirectory);
    await mkdir(cache, { recursive: true });
    const unlock = await lockfile.lock(cache, {
        retries: { retries: 180, minTimeout: 1000, maxTimeout: 1000 },
    });
    try {
        return await prepareLocked();
    } finally {
        await unlock();
    }
}

async function prepareLocked() {
    try {
        await verifyFreeRDP(freeRDPDirectory);
        console.log(`Using verified WBFreeRDP ${winboatFreeRDP.tag}`);
        return freeRDPDirectory;
    } catch {
        // A missing, incomplete or older cache is replaced only after verifying the download.
    }

    const cache = Path.dirname(freeRDPDirectory);
    const temporary = Path.join(cache, `.prepare-${process.pid}-${randomUUID()}`);
    await mkdir(temporary);
    const archive = Path.join(temporary, winboatFreeRDP.fileName);
    try {
        if (process.env.WINBOAT_FREERDP_ARCHIVE) {
            await copyFile(Path.resolve(process.env.WINBOAT_FREERDP_ARCHIVE), archive);
        } else {
            console.log(`Downloading WBFreeRDP ${winboatFreeRDP.tag}...`);
            const response = await fetch(winboatFreeRDP.url, {
                headers: { "User-Agent": "WinBoat-build" },
                redirect: "follow",
                signal: AbortSignal.timeout(120_000),
            });
            if (!response.ok || !response.body) throw new Error(`WBFreeRDP download failed: HTTP ${response.status}`);
            await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: "wx" }));
        }
        if ((await sha256(archive)) !== winboatFreeRDP.archiveSha256) {
            throw new Error("WBFreeRDP archive checksum mismatch; refusing to extract it.");
        }
        await execFileAsync("tar", [
            "--extract",
            "--gzip",
            "--no-same-owner",
            "--file",
            archive,
            "--directory",
            temporary,
        ]);
        const extracted = Path.join(temporary, "wbfreerdp");
        await chmod(Path.join(extracted, "xfreerdp"), 0o755);
        await verifyFreeRDP(extracted);
        await rm(freeRDPDirectory, { recursive: true, force: true });
        await rename(extracted, freeRDPDirectory);
        console.log(`WBFreeRDP is ready at ${freeRDPDirectory}`);
        return freeRDPDirectory;
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && Path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await prepareFreeRDP();
}

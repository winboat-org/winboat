import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import Path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { winboatElectron } from "./electron-release.mjs";

const scriptDirectory = Path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = Path.dirname(scriptDirectory);
const cacheDirectory = Path.join(projectDirectory, ".cache", "electron");
const archivePath = Path.join(cacheDirectory, winboatElectron.fileName);

async function sha256(filePath) {
    const hash = createHash("sha256");

    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }

    return hash.digest("hex");
}

async function verifyArchive(filePath) {
    const file = await stat(filePath);

    if (file.size !== winboatElectron.archiveSize) {
        throw new Error(`Expected ${winboatElectron.archiveSize} bytes, but ${filePath} contains ${file.size} bytes.`);
    }

    const digest = await sha256(filePath);

    if (digest !== winboatElectron.archiveSha256) {
        throw new Error(`SHA-256 verification failed for ${filePath}.`);
    }
}

async function useLocalArchive(sourcePath, temporaryPath) {
    const resolvedSource = Path.resolve(sourcePath);
    await verifyArchive(resolvedSource);
    await copyFile(resolvedSource, temporaryPath);
}

async function downloadArchive(temporaryPath) {
    console.log(`Downloading ${winboatElectron.fileName}...`);

    const response = await fetch(winboatElectron.url, {
        headers: { "User-Agent": "WinBoat-build" },
        redirect: "follow",
    });

    if (!response.ok || !response.body) {
        throw new Error(`Electron download failed with HTTP ${response.status}.`);
    }

    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath, { flags: "wx" }));
}

async function prepareElectron() {
    if (process.platform !== "linux" || process.arch !== "x64") {
        throw new Error("The WinBoat Electron fork currently supports Linux x64 only.");
    }

    await mkdir(cacheDirectory, { recursive: true });

    try {
        await verifyArchive(archivePath);
        console.log(`Using verified WinBoat Electron archive at ${archivePath}`);
        return;
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.warn(`Discarding invalid cached Electron archive: ${error.message}`);
            await rm(archivePath, { force: true });
        }
    }

    const temporaryPath = `${archivePath}.${process.pid}.${randomUUID()}.part`;

    try {
        const localArchive = process.env.WINBOAT_ELECTRON_ZIP;

        if (localArchive) {
            await useLocalArchive(localArchive, temporaryPath);
        } else {
            await downloadArchive(temporaryPath);
        }

        await verifyArchive(temporaryPath);
        await rename(temporaryPath, archivePath);

        console.log(`WinBoat Electron ${winboatElectron.tag} is ready at ${archivePath}`);
    } finally {
        await rm(temporaryPath, { force: true });
    }
}

await prepareElectron();

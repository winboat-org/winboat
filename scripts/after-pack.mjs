import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import Path from "node:path";
import { pipeline } from "node:stream/promises";
import { constants, createBrotliCompress } from "node:zlib";
import { Arch } from "electron-builder";
import { winboatElectron } from "./electron-release.mjs";
import { verifyFreeRDP } from "./prepare-freerdp.mjs";

async function verifyElectronExecutable(context) {
    if (context.electronPlatformName !== "linux" || context.arch !== Arch.x64) {
        throw new Error("The WinBoat Electron fork currently supports Linux x64 only.");
    }

    const executable = Path.join(context.appOutDir, context.packager.executableName);
    const hash = createHash("sha256");

    for await (const chunk of createReadStream(executable)) {
        hash.update(chunk);
    }

    if (hash.digest("hex") !== winboatElectron.executableSha256) {
        throw new Error("The packaged executable does not match the published WinBoat Electron fork.");
    }
}

async function compressChromiumLicenses(appOutDir) {
    const input = Path.join(appOutDir, "LICENSES.chromium.html");
    const output = `${input}.br`;
    let inputSize;

    try {
        inputSize = (await stat(input)).size;
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }

    const compressor = createBrotliCompress({
        params: {
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_LGWIN]: constants.BROTLI_MAX_WINDOW_BITS,
            [constants.BROTLI_PARAM_SIZE_HINT]: inputSize,
        },
    });

    await pipeline(createReadStream(input), compressor, createWriteStream(output));
    await rm(input);
    await writeFile(
        Path.join(appOutDir, "LICENSES.chromium.README.txt"),
        [
            "Chromium and third-party license notices are in LICENSES.chromium.html.br.",
            "The file uses Brotli compression.",
            "Use `brotli --decompress LICENSES.chromium.html.br` to restore the HTML file.",
            "",
        ].join("\n"),
    );
}

export default async function afterPack(context) {
    await verifyElectronExecutable(context);
    await verifyFreeRDP(Path.join(context.appOutDir, "resources", "freerdp"));

    for (const handler of ["chrome_crashpad_handler", "chrome_crashpad_handler.exe"]) {
        await rm(Path.join(context.appOutDir, handler), { force: true });
    }

    await compressChromiumLicenses(context.appOutDir);
}

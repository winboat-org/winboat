import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { Jimp, JimpMime }: typeof import("jimp") = require("jimp");

describe("custom icon decoding", () => {
    it("rejects a malformed ASF header without hanging the image decoder", () => {
        // CVE-2026-31808: a zero-size ASF sub-header used to loop forever.
        // A separate process is necessary: the loop also prevents JS timers from firing.
        const result = spawnSync(
            process.execPath,
            [
                "--eval",
                `
                    import assert from "node:assert/strict";
                    const { Jimp } = require("jimp");
                    const input = Buffer.alloc(55);
                    input.set([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]);
                    await assert.rejects(Jimp.read(input));
                    process.stdout.write("rejected");
                `,
            ],
            {
                cwd: new URL("..", import.meta.url),
                encoding: "utf8",
                timeout: 3000,
                killSignal: "SIGKILL",
            },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("rejected");
    });

    it("still decodes and resizes a PNG into a custom icon", async () => {
        const input = readFileSync(new URL("../src/renderer/public/img/winboat_logo.png", import.meta.url));
        const image = await Jimp.read(input);
        image.resize({ w: 128, h: 128 });
        const output = await image.getBuffer(JimpMime.png);
        expect(output.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        const decoded = await Jimp.read(output);
        expect(decoded.bitmap.width).toBe(128);
        expect(decoded.bitmap.height).toBe(128);
    });
});

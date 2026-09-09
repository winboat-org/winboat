import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function fixture() {
    const root = mkdtempSync(join(tmpdir(), "winboat prepare with spaces "));
    directories.push(root);
    const scripts = join(root, "scripts");
    const bundle = join(root, "input/wbfreerdp");
    mkdirSync(scripts);
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
    mkdirSync(join(bundle, "licenses/FreeRDP"), { recursive: true });
    copyFileSync(new URL("../scripts/prepare-freerdp.mjs", import.meta.url), join(scripts, "prepare-freerdp.mjs"));
    const executable = join(bundle, "xfreerdp");
    writeFileSync(executable, '#!/bin/sh\necho "This is FreeRDP version 3.30.0 (test fixture)"\n', { mode: 0o755 });
    const executableSha256 = digest(executable);
    writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ executableSha256, architecture: "x64" }));
    writeFileSync(join(bundle, "licenses/FreeRDP/LICENSE"), "fixture notice");
    writeFileSync(join(bundle, "SOURCES.md"), "fixture source reference");
    const archive = join(root, "bundle.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", join(root, "input"), "wbfreerdp"]);
    writeFileSync(
        join(scripts, "freerdp-release.mjs"),
        `export const winboatFreeRDP = ${JSON.stringify({
            tag: "fixture",
            fileName: "bundle.tar.gz",
            archiveSha256: digest(archive),
            executableSha256,
            url: "https://invalid.invalid/must-not-download",
        })};`,
    );
    return {
        root,
        archive,
        script: join(scripts, "prepare-freerdp.mjs"),
        prepared: join(root, ".cache/freerdp/linux-x64/wbfreerdp"),
        run: (source = archive) =>
            Bun.spawn([process.execPath, join(scripts, "prepare-freerdp.mjs")], {
                env: { ...process.env, WINBOAT_FREERDP_ARCHIVE: source },
                stdout: "pipe",
                stderr: "pipe",
            }),
    };
}

test("prepares offline and reuses the verified cache without the original archive", async () => {
    const f = fixture();
    expect(await f.run().exited).toBe(0);
    expect(existsSync(join(f.prepared, "xfreerdp"))).toBe(true);
    rmSync(f.archive);
    expect(await f.run().exited).toBe(0);
});

test("rejects an altered archive before installing or executing its contents", async () => {
    const f = fixture();
    writeFileSync(f.archive, "not the pinned archive");
    const child = f.run();
    expect(await child.exited).not.toBe(0);
    expect(await new Response(child.stderr).text()).toContain("archive checksum mismatch");
    expect(existsSync(f.prepared)).toBe(false);
});

test("repairs a damaged cached executable from the verified offline archive", async () => {
    const f = fixture();
    expect(await f.run().exited).toBe(0);
    writeFileSync(join(f.prepared, "xfreerdp"), "damaged");
    expect(await f.run().exited).toBe(0);
    expect(readFileSync(join(f.prepared, "xfreerdp"), "utf8")).toContain("version 3.30.0");
});

test("concurrent preparation leaves one complete executable and notices", async () => {
    const f = fixture();
    const children = [f.run(), f.run(), f.run()];
    expect(await Promise.all(children.map(child => child.exited))).toEqual([0, 0, 0]);
    expect(existsSync(join(f.prepared, "licenses/FreeRDP/LICENSE"))).toBe(true);
    expect(existsSync(join(f.root, ".cache/freerdp/linux-x64.lock"))).toBe(false);
});

test("a failed preparation can be retried in the same process", async () => {
    const f = fixture();
    const child = Bun.spawn([process.execPath, "--eval", `
        const { prepareFreeRDP } = await import(${JSON.stringify(f.script)});
        process.env.WINBOAT_FREERDP_ARCHIVE = ${JSON.stringify(f.archive + ".missing")};
        try {
            await prepareFreeRDP();
            throw new Error("Missing archive unexpectedly succeeded");
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        process.env.WINBOAT_FREERDP_ARCHIVE = ${JSON.stringify(f.archive)};
        await prepareFreeRDP();
    `], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(existsSync(join(f.prepared, "xfreerdp"))).toBe(true);
});

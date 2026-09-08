import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    appKey,
    deleteShortcut,
    detectLauncher,
    readLauncher,
    readShortcuts,
    saveShortcut,
    writeLauncher,
} from "../src/renderer/lib/shortcut-files";
import { spawnDetached } from "../src/renderer/lib/exec-helper";
import { getFreeRDP } from "../src/renderer/utils/getFreeRDP";
import type { WinApp } from "../src/types";

const directories: string[] = [];
function temporaryDirectory() {
    const directory = mkdtempSync(join(tmpdir(), "winboat-shortcuts-"));
    directories.push(directory);
    return directory;
}
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

const app: WinApp = {
    Name: "Editor",
    Path: "C:\\Editor\\editor.exe",
    Args: "--profile default",
    Source: "custom",
    Icon: "",
};

describe("shortcut launcher", () => {
    it("does not mistake an inherited Flatpak terminal identity for WinBoat", () => {
        expect(detectLauncher({ FLATPAK_ID: "org.example.Terminal" }, "/usr/bin/winboat")).toEqual({
            type: "bin",
            executable: "/usr/bin/winboat",
            args: [],
        });
    });
    it("uses the persistent AppImage and represents Flatpak as executable plus arguments", () => {
        expect(detectLauncher({ APPIMAGE: "/Applications/WB.AppImage" }, "/tmp/.mount/winboat")).toEqual({
            type: "appimage",
            executable: "/Applications/WB.AppImage",
            args: [],
        });
        expect(detectLauncher({ FLATPAK_ID: "com.teabox.winboat" }, "/app/bin/winboat")).toEqual({
            type: "flatpak",
            executable: "flatpak",
            args: ["run", "com.teabox.winboat"],
        });
    });

    it("passes spaces, quotes, dollar signs and empty arguments literally without evaluating config", () => {
        const directory = temporaryDirectory();
        const fakeApp = join(directory, "WinBoat's $test app");
        writeFileSync(fakeApp, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
        const args = ["two words", 'quote"', "$(touch SHOULD_NOT_EXIST)", "", "trailing "];
        const launcher = { type: "bin" as const, executable: fakeApp, args };
        writeLauncher(launcher, directory);
        expect(readLauncher(directory)).toEqual(launcher);
        expect(execFileSync(join(directory, "launch"), ["shortcut-id"], { cwd: directory, encoding: "utf8" })).toBe(
            [...args, "--shortcut", "shortcut-id", ""].join("\n"),
        );
        expect(existsSync(join(directory, "SHOULD_NOT_EXIST"))).toBe(false);
    });

    it("switches all existing shortcuts by changing only the launcher configuration", () => {
        const directory = temporaryDirectory();
        const oldApp = join(directory, "old");
        const newApp = join(directory, "new");
        for (const file of [oldApp, newApp])
            writeFileSync(file, `#!/bin/sh\necho ${file === oldApp ? "old" : "new"}\n`, { mode: 0o700 });
        writeLauncher({ type: "appimage", executable: oldApp, args: [] }, directory);
        const shortcut = saveShortcut(
            {
                app,
                name: "Editor",
                extraArgs: "",
                destination: "both",
            },
            directory,
            join(directory, "applications"),
            join(directory, "Desktop"),
        );
        const before = shortcut.files.map(file => readFileSync(file, "utf8"));
        writeLauncher({ type: "appimage", executable: newApp, args: [] }, directory);
        expect(execFileSync(join(directory, "launch"), [shortcut.id], { encoding: "utf8" })).toBe("new\n");
        expect(shortcut.files.map(file => readFileSync(file, "utf8"))).toEqual(before);
    });

    it("rejects line breaks instead of silently changing argument boundaries", () => {
        expect(() =>
            writeLauncher({ type: "bin", executable: "/bin/app", args: ["first\nsecond"] }, temporaryDirectory()),
        ).toThrow();
    });
});

describe("shortcut files", () => {
    it("keeps one ID per original target, edits both destinations and deletes both copies", () => {
        const directory = temporaryDirectory();
        const applications = join(directory, "applications");
        const desktop = join(directory, "Desktop");
        writeLauncher({ type: "bin", executable: "/bin/winboat", args: [] }, directory);
        const first = saveShortcut(
            {
                app,
                name: "Editor",
                extraArgs: "",
                destination: "both",
            },
            directory,
            applications,
            desktop,
        );
        const second = saveShortcut(
            {
                app,
                name: "Work editor",
                extraArgs: "--work",
                destination: "both",
            },
            directory,
            applications,
            desktop,
        );
        expect(second.id).toBe(first.id);
        expect(readShortcuts(directory)).toHaveLength(1);
        for (const file of second.files) expect(readFileSync(file, "utf8")).toContain("Name=Work editor");
        const third = saveShortcut(
            {
                app,
                name: "Work editor",
                extraArgs: "",
                destination: "applications",
            },
            directory,
            applications,
            desktop,
        );
        expect(existsSync(first.files[1])).toBe(false);
        expect(third.files).toHaveLength(1);
        deleteShortcut(first.id, directory);
        expect(readShortcuts(directory)).toEqual([]);
        expect(first.files.some(existsSync)).toBe(false);
    });

    it("distinguishes apps that share explorer.exe through their original arguments", () => {
        expect(appKey({ Path: "explorer.exe", Args: "ms-settings:" })).not.toBe(
            appKey({ Path: "explorer.exe", Args: "shell:AppsFolder\\Package!App" }),
        );
        expect(appKey({ Path: "C:/Editor/EDITOR.exe", Args: "" })).toBe(
            appKey({ Path: "c:\\editor\\editor.exe", Args: "" }),
        );
    });

    it("refuses a disabled desktop and leaves another app's desktop entry alone", () => {
        const directory = temporaryDirectory();
        expect(() =>
            saveShortcut({ app, name: "Editor", extraArgs: "", destination: "desktop" }, directory, directory, null),
        ).toThrow("disabled");
        const shortcut = saveShortcut(
            {
                app,
                name: "Editor",
                extraArgs: "",
                destination: "applications",
            },
            directory,
            directory,
            null,
        );
        writeFileSync(shortcut.files[0], "[Desktop Entry]\nName=Something else\n");
        deleteShortcut(shortcut.id, directory);
        expect(existsSync(shortcut.files[0])).toBe(true);
    });

    it("writes valid desktop entries with literal names and escaped executable paths", () => {
        const directory = join(temporaryDirectory(), 'space $quote" percent%');
        writeLauncher({ type: "bin", executable: "/bin/winboat", args: [] }, directory);
        const shortcut = saveShortcut(
            {
                app,
                name: "Name\nExec=unexpected",
                extraArgs: "",
                destination: "applications",
            },
            directory,
            join(directory, "applications"),
            null,
        );
        expect(readFileSync(shortcut.files[0], "utf8")).toContain("Name=Name\\nExec=unexpected");
        const validation = spawnSync("desktop-file-validate", [shortcut.files[0]], { encoding: "utf8" });
        if (!validation.error) expect(validation.status, validation.stdout + validation.stderr).toBe(0);
    });
});

describe("FreeRDP process lifetime", () => {
    it("cancels FreeRDP detection instead of continuing to another installation", async () => {
        const directory = temporaryDirectory();
        writeFileSync(join(directory, "xfreerdp3"), '#!/bin/sh\nsleep 1\necho "version 3.0"\n', { mode: 0o700 });
        const previousPath = process.env.PATH;
        process.env.PATH = `${directory}:${previousPath}`;
        try {
            await expect(getFreeRDP(AbortSignal.timeout(20))).rejects.toThrow();
        } finally {
            process.env.PATH = previousPath;
        }
    });

    it("reports a missing executable as a launch failure", async () => {
        await expect(spawnDetached("/nonexistent/winboat-test-executable", [])).rejects.toThrow();
    });

    it("still launches the app if its log cannot be opened", async () => {
        const directory = temporaryDirectory();
        const marker = join(directory, "launched");
        const child = await spawnDetached(process.execPath, [
            "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done')`,
        ], join(directory, "missing-directory", "freerdp.log"));
        await once(child, "exit");
        expect(readFileSync(marker, "utf8")).toBe("done");
    });

    it("keeps only the latest run's output even while an older session is still running", async () => {
        const directory = temporaryDirectory();
        const logFile = join(directory, "freerdp.log");
        const ready = join(directory, "ready");
        const release = join(directory, "release");
        const older = await spawnDetached(process.execPath, ["-e", `
            const fs = require('node:fs');
            fs.writeSync(1, 'old stdout\\n');
            fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
            const timer = setInterval(() => {
                if (!fs.existsSync(${JSON.stringify(release)})) return;
                fs.writeSync(2, 'old late stderr\\n');
                clearInterval(timer);
            }, 10);
        `], logFile);
        const olderExit = once(older, "exit");
        try {
            const deadline = Date.now() + 3000;
            while (!existsSync(ready) && Date.now() < deadline) await Bun.sleep(10);
            expect(existsSync(ready)).toBe(true);
            const latest = await spawnDetached(process.execPath, ["-e", `
                const fs = require('node:fs');
                fs.writeSync(1, 'latest stdout\\n');
                fs.writeSync(2, 'latest stderr\\n');
            `], logFile);
            await once(latest, "exit");
            writeFileSync(release, "done");
            await olderExit;
            expect(readFileSync(logFile, "utf8")).toBe("latest stdout\nlatest stderr\n");
        } finally {
            older.kill();
        }
    });

    it("keeps logging after WinBoat's process exits", async () => {
        const directory = temporaryDirectory();
        const marker = join(directory, "finished");
        const logFile = join(directory, "freerdp.log");
        const runner = join(directory, "parent.ts");
        const helper = resolve("src/renderer/lib/exec-helper.ts");
        const childScript = `setTimeout(() => {
            const fs = require('node:fs');
            fs.writeSync(1, 'detached stdout\\n');
            fs.writeSync(2, 'detached stderr\\n');
            fs.writeFileSync(${JSON.stringify(marker)}, 'done');
        }, 100)`;
        writeFileSync(
            runner,
            `import { spawnDetached } from ${JSON.stringify(helper)};\nawait spawnDetached(process.execPath, ["-e", ${JSON.stringify(childScript)}], ${JSON.stringify(logFile)});\n`,
        );
        execFileSync(process.execPath, [runner], { timeout: 3000 });
        const deadline = Date.now() + 3000;
        while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(20);
        expect(readFileSync(marker, "utf8")).toBe("done");
        expect(readFileSync(logFile, "utf8")).toBe("detached stdout\ndetached stderr\n");
    });
});

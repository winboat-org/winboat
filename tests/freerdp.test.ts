import { afterEach, describe, expect, mock, test } from "bun:test";
import { bundledFreeRDPPath } from "../src/main/runtime-paths";

let available: Record<string, string> = {};
let calls: { file: string; args: string[] }[] = [];
const bundled = "/tmp/WinBoat with spaces/resources/freerdp/xfreerdp";
mock.module("../src/renderer/lib/electron", () => ({ getBundledFreeRDPPath: async () => bundled }));
mock.module("../src/renderer/lib/exec-helper", () => ({
    execFileAsync: async (file: string, args: string[]) => {
        calls.push({ file, args });
        const output = available[file];
        if (output === undefined) throw new Error("ENOENT");
        return { stdout: output, stderr: "" };
    },
    spawnDetached: async (file: string, args: string[]) => {
        calls.push({ file, args });
        return { pid: 123 };
    },
    stringifyExecFile: (file: string, args: string[]) => JSON.stringify([file, ...args]),
}));
const { getFreeRDP, getSystemFreeRDP } = await import("../src/renderer/utils/getFreeRDP");

afterEach(() => {
    available = {};
    calls = [];
});

describe("FreeRDP selection", () => {
    test("defaults to the bundle even when system FreeRDP is installed", async () => {
        available = { [bundled]: "FreeRDP version 3.30.0", xfreerdp3: "FreeRDP version 3.30.0" };
        expect((await getFreeRDP())?.file).toBe(bundled);
        expect(calls.map(call => call.file)).toEqual([bundled]);
    });
    test("works without any system client and preserves spaced paths/arguments on launch", async () => {
        available = { [bundled]: "FreeRDP version 3.30.0" };
        const installation = await getFreeRDP();
        await installation!.launch(["/app:program:C:\\Program Files\\Example\\app.exe", "/p:a b"]);
        expect(calls.at(-1)).toEqual({
            file: bundled,
            args: ["+auto-reconnect", "/app:program:C:\\Program Files\\Example\\app.exe", "/p:a b"],
        });
    });
    test("system opt-in retains xfreerdp3 priority", async () => {
        available = { xfreerdp3: "FreeRDP version 3.30.0", xfreerdp: "FreeRDP version 3.20.0" };
        const installation = await getFreeRDP(true);
        expect(installation?.file).toBe("xfreerdp3");
        await installation!.launch(["/v:example"]);
        expect(calls.at(-1)?.args).toEqual(["/v:example"]);
    });
    test("skips FreeRDP 2 and detects the Flatpak client", async () => {
        available = { xfreerdp: "FreeRDP version 2.11.0", flatpak: "FreeRDP version 3.30.0" };
        const installation = await getSystemFreeRDP();
        expect(installation?.file).toBe("flatpak");
        await installation!.launch(["/v:example"]);
        expect(calls.at(-1)?.args).toEqual(["run", "--command=xfreerdp", "com.freerdp.FreeRDP", "/v:example"]);
    });
    test("falls back to the bundle if a selected system client disappears", async () => {
        available = { [bundled]: "FreeRDP version 3.30.0" };
        const installation = await getFreeRDP(true);
        expect(installation?.file).toBe(bundled);
        await installation!.launch(["/v:example"]);
        expect(calls.at(-1)?.args).toEqual(["+auto-reconnect", "/v:example"]);
    });
    test("does not silently select a system binary when the default bundle is broken", async () => {
        available = { xfreerdp: "FreeRDP version 3.30.0" };
        expect(await getFreeRDP()).toBeNull();
        expect(calls.map(call => call.file)).toEqual([bundled]);
    });
});

describe("FreeRDP resource paths", () => {
    test("development resolves from the compiled main directory rather than cwd", () => {
        expect(
            bundledFreeRDPPath({
                isPackaged: false,
                resourcesPath: "/electron/resources",
                appPath: "/project with spaces/build/main",
                arch: "x64",
            }),
        ).toBe("/project with spaces/.cache/freerdp/linux-x64/wbfreerdp/xfreerdp");
    });
    for (const resourcesPath of [
        "/tmp/.mount_winboat123/resources",
        "/opt/WinBoat/resources",
        "/downloads/linux-unpacked/resources",
    ]) {
        test(`packaged resources at ${resourcesPath}`, () => {
            expect(
                bundledFreeRDPPath({
                    isPackaged: true,
                    resourcesPath,
                    appPath: resourcesPath + "/app.asar",
                    arch: "x64",
                }),
            ).toBe(resourcesPath + "/freerdp/xfreerdp");
        });
    }
});

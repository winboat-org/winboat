import { mock } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [scenario, runtime] = process.argv.slice(2);
const data = mkdtempSync(join(tmpdir(), "winboat-lifecycle-"));
process.env.XDG_DATA_HOME = data;
process.env.VITE_APP_VERSION = "1.0.6";
mkdirSync(join(data, "winboat-app"));

const events: { channel: string; args: unknown[] }[] = [];
const ipc = Object.assign(new EventEmitter(), {
    send: (channel: string, ...args: unknown[]) => events.push({ channel, args }),
    invoke: async (channel: string) => {
        if (channel === "desktop:ready")
            return { isPackaged: false, hasTray: true, shortcuts: [], shortcutLaunch: false };
        throw new Error(`Unexpected IPC request: ${channel}`);
    },
});
mock.module("electron", () => ({ ipcRenderer: ipc }));

let state = { Status: "running", ExitCode: 0, OOMKilled: false, Error: "" };
let available = true;
let unreadableExit = false;
const actions: string[] = [];
let onStop = () => {
    state.Status = "exited";
};
mock.module("../../src/renderer/lib/exec-helper", () => ({
    execFileAsync: async (file: string, args: string[]) => {
        assert.equal(file, runtime.toLowerCase());
        if (!available) throw new Error(`Cannot connect to ${runtime}`);
        if (args[0] === "inspect") {
            if (args[1] === "--format={{.State.Status}}") return { stdout: state.Status, stderr: "" };
            assert.equal(args[1], "--format={{json .State}}");
            if (unreadableExit) throw new Error("Container disappeared before exit inspection");
            return { stdout: JSON.stringify(state), stderr: "" };
        }
        assert.equal(args[0], "container");
        actions.push(args[1]);
        if (args[1] === "stop") onStop();
        else if (args[1] === "unpause") state.Status = "running";
        else throw new Error(`Unexpected container action: ${args[1]}`);
        return { stdout: "WinBoat", stderr: "" };
    },
    stringifyExecFile: (file: string, args: string[]) => [file, ...args].join(" "),
    concatEnv: (base: object, extra: object) => ({ ...base, ...extra }),
    spawnDetached: () => {
        throw new Error("Unexpected process launch");
    },
}));

const savedSetInterval = globalThis.setInterval;
const savedClearInterval = globalThis.clearInterval;
const timers: { callback: () => Promise<void>; active: boolean }[] = [];
globalThis.setInterval = ((callback: () => Promise<void>) => {
    const timer = { callback, active: true };
    timers.push(timer);
    return timer;
}) as unknown as typeof setInterval;
globalThis.clearInterval = ((timer: { active: boolean }) => {
    if (timer) timer.active = false;
}) as unknown as typeof clearInterval;

try {
    const { Winboat } = await import("../../src/renderer/lib/winboat");
    const { WinboatConfig } = await import("../../src/renderer/lib/config");
    const { ContainerStatus, ContainerRuntimes } = await import("../../src/renderer/lib/containers/common");
    const { initializeDesktop, desktopFailure } = await import("../../src/renderer/lib/shortcuts");
    const { nextTick } = await import("vue");
    const config = WinboatConfig.getInstance().config;
    config.containerRuntime = runtime === "Podman" ? ContainerRuntimes.PODMAN : ContainerRuntimes.DOCKER;
    config.shutdownOnQuit = true;
    config.closeAction = "quit";

    if (scenario.startsWith("install-") || scenario === "setup-close") {
        await initializeDesktop(null);
        if (scenario.startsWith("install-")) {
            const { InstallManager, InstallStates } = await import("../../src/renderer/lib/install");
            const installer = new InstallManager({ container: config.containerRuntime, gpuEnabled: false } as any);
            const failedStep = scenario.slice("install-".length);
            for (const step of [
                "createComposeFile",
                "createOEMAssets",
                "startContainer",
                "monitorContainerPreinstall",
                "monitorAPIHealth",
            ]) {
                (installer as any)[step] = async () => {
                    if (step === failedStep) throw new Error(`Simulated failure at ${step}`);
                };
            }
            await installer.install();
            await nextTick();
            assert.equal(installer.state, InstallStates.INSTALL_ERROR);
            assert.equal(desktopFailure.value, null);
            assert.equal(events.filter(event => event.channel === "shortcut:state").length, 0);
        } else {
            available = false;
            await (ipc.listeners("window:closing")[0] as Function)({}, "close");
            assert.equal(events.filter(event => event.channel === "app:exit").length, 1);
            assert.equal(desktopFailure.value, null);
            assert.deepEqual(actions, []);
        }
    } else {
        const wb = Winboat.getInstance();
        wb.getHealth = async () => true;
        wb.checkVersionAndUpdateGuestServer = async () => {};
        await wb.setContainerStatus(ContainerStatus.RUNNING);
        const healthTick = timers[1].callback;
        await initializeDesktop(wb);

        if (["version-retry", "health-retry", "single-version-check", "stop-during-version-check"].includes(scenario)) {
            let checks = 0;
            let release!: () => void;
            const pending = new Promise<void>(resolve => {
                release = resolve;
            });
            wb.checkVersionAndUpdateGuestServer = async () => {
                checks++;
                if (scenario === "version-retry" && checks === 1) throw new Error("Temporary version failure");
                if (scenario === "single-version-check" || scenario === "stop-during-version-check") await pending;
            };
            if (scenario === "health-retry") {
                let healthChecks = 0;
                wb.getHealth = async () => ++healthChecks !== 2;
            }
            if (scenario === "version-retry" || scenario === "health-retry") {
                await healthTick();
                assert.equal(wb.guestReady.value, false);
                assert.equal(wb.isOnline.value, true);
                await healthTick();
                assert.equal(wb.guestReady.value, true);
                for (let i = 0; i < 3; i++) await healthTick();
                assert.equal(checks, 2);
            } else {
                const first = healthTick();
                await Promise.resolve();
                assert.equal(checks, 1);
                await healthTick();
                assert.equal(checks, 1);
                if (scenario === "stop-during-version-check") await wb.stopContainer();
                release();
                await first;
                assert.equal(wb.guestReady.value, scenario !== "stop-during-version-check");
            }
            assert.equal(desktopFailure.value, null);
        } else if (scenario.startsWith("quit-")) {
            if (scenario === "quit-unavailable" || scenario === "quit-without-shutdown") available = false;
            if (scenario === "quit-without-shutdown") config.shutdownOnQuit = false;
            if (scenario === "quit-paused") {
                state.Status = "paused";
                await wb.setContainerStatus(ContainerStatus.PAUSED);
            }
            if (["quit-runtime-lost", "quit-already-stopped", "quit-stop-failure"].includes(scenario)) {
                onStop = () => {
                    if (scenario === "quit-runtime-lost") available = false;
                    if (scenario === "quit-already-stopped") state.Status = "exited";
                    throw new Error("Stop command failed");
                };
            }
            await (ipc.listeners("window:closing")[0] as Function)({}, "quit");
            await nextTick();
            const stopFailed = scenario === "quit-stop-failure";
            assert.equal(events.filter(event => event.channel === "app:exit").length, stopFailed ? 0 : 1);
            if (stopFailed) assert.equal(desktopFailure.value?.kind, "container-error");
            else assert.equal(desktopFailure.value, null);
            assert.deepEqual(
                actions,
                scenario === "quit-paused"
                    ? ["unpause", "stop"]
                    : ["quit-unavailable", "quit-without-shutdown"].includes(scenario)
                      ? []
                      : ["stop"],
            );
        } else {
            const fails = ["failed-exit", "oom-exit", "exit-after-unknown", "podman-stopping"].includes(scenario);
            state.ExitCode = fails || scenario === "dashboard-stop" ? 137 : 0;
            state.OOMKilled = scenario === "oom-exit";
            unreadableExit = scenario === "unreadable-exit";
            if (scenario === "dashboard-stop") await wb.stopContainer();
            else {
                if (scenario === "podman-stopping") {
                    state.Status = "stopping";
                    await timers[0].callback();
                    await nextTick();
                    assert.equal(desktopFailure.value, null);
                    assert.equal(wb.containerStatus.value, ContainerStatus.UNKNOWN);
                } else if (scenario === "exit-after-unknown") {
                    available = false;
                    await timers[0].callback();
                    available = true;
                }
                state.Status = "exited";
                await timers[0].callback();
            }
            await nextTick();
            assert.equal(wb.containerStatus.value, ContainerStatus.EXITED);
            assert.equal(wb.guestReady.value, false);
            if (fails) {
                assert.equal(desktopFailure.value?.kind, "container-error");
                assert.match(
                    desktopFailure.value?.detail ?? "",
                    scenario === "oom-exit" ? /out of memory/ : /code 137/,
                );
            } else {
                assert.equal(desktopFailure.value, null);
                assert.equal(events.filter(event => event.channel === "window:action").length, 0);
            }
        }
    }
    console.log(`Passed: ${runtime} ${scenario}`);
} finally {
    globalThis.setInterval = savedSetInterval;
    globalThis.clearInterval = savedClearInterval;
    rmSync(data, { recursive: true, force: true });
}

import { ref, watch } from "vue";
import type { LaunchAction, LaunchState, Shortcut } from "../../types";
import { exitApp, performWindowAction, showMessageBox } from "./electron";
import { WinboatConfig } from "./config";
import {
    shortcuts,
    refreshShortcuts,
    deleteShortcut,
    detectLauncher,
    readLauncher,
    writeLauncher,
} from "./shortcut-files";
import { ContainerStatus } from "./containers/container";
import { Winboat, logger } from "./winboat";
import { WINBOAT_API_URL } from "./constants";
import { guestAuthHeaders } from "../utils/guestServer";
import { InternalApps } from "../data/internalapps";
import {
    ContainerStatusTimeout,
    ContainerStopped,
    GuestServiceError,
    GuestTimeout,
    waitForStartup,
    withAbort,
} from "./shortcut-startup";

const { ipcRenderer }: typeof import("electron") = require("electron");
const process: typeof import("process") = require("node:process");
const nodeFetch: typeof import("node-fetch").default = require("node-fetch");
export const desktopFailure = ref<LaunchState | null>(null);
export const logsOpen = ref(false);
export async function initializeDesktop(winboat: Winboat | null) {
    const queue: string[] = [];
    let quitting = false;
    let closePromptOpen = false;
    let hasTray = false;
    let activeId: string | null = null;
    let activeAppName: string | null = null;
    let controller: AbortController | null = null;
    let answer: ((action: LaunchAction) => void) | null = null;
    let state: LaunchState | null = null;

    const publish = (value: LaunchState | null) => {
        state = value;
        ipcRenderer.send("shortcut:state", value && { ...value });
    };
    const ask = (value: LaunchState): Promise<LaunchAction> =>
        new Promise(resolve => {
            answer = resolve;
            publish(value);
        });

    ipcRenderer.on("shortcut:action", (_event, action: LaunchAction) => {
        if (action === "quit") {
            void quit(false);
            return;
        }
        if (action === "cancel") controller?.abort();
        const respond = answer;
        answer = null;
        respond?.(action);
    });

    if (winboat)
        watch(winboat.failure, failure => {
            if (!failure) return;
            if (controller && failure.kind === "container-error") return;
            if (controller && state?.kind === "launched" && activeAppName === failure.name) publish(failure);
            else {
                desktopFailure.value = failure;
                performWindowAction("show-error");
            }
        });

    async function launch(id: string) {
        controller = new AbortController();
        const signal = controller.signal;
        let shortcut: Shortcut | undefined;
        try {
            if (!winboat) throw new Error("Set up WinBoat before opening this shortcut.");
            refreshShortcuts();
            shortcut = shortcuts.value.find(item => item.id === id);
            if (!shortcut)
                throw new Error("This shortcut is no longer registered. Create it again from WinBoat's Apps page.");
            activeAppName = shortcut.app.Name;
            const base = { name: shortcut.name, icon: shortcut.app.Icon };
            publish({ ...base, kind: "starting", message: "Checking Windows…" });
            try {
                await winboat.waitForContainerAction(signal);
            } catch (error) {
                throw new ContainerStopped(String(error));
            }
            let status!: ContainerStatus;
            await waitForStartup(
                async () => {
                    status = await winboat.containerMgr!.getStatus();
                    return status === ContainerStatus.UNKNOWN ? "unknown" : "ready";
                },
                signal,
                () => {},
            );
            signal.throwIfAborted();
            if (status !== ContainerStatus.RUNNING) {
                if (!WinboatConfig.getInstance().config.autoStartShortcuts) {
                    const action = await ask({
                        ...base,
                        kind: "confirm",
                        message: `Start Windows to open ${shortcut.name}?`,
                    });
                    if (action === "cancel") return;
                    if (action === "always-start") WinboatConfig.getInstance().config.autoStartShortcuts = true;
                }
                signal.throwIfAborted();
                publish({ ...base, kind: "starting", message: "Starting Windows…" });
                try {
                    await withAbort(
                        status === ContainerStatus.PAUSED ? winboat.unpauseContainer() : winboat.startContainer(),
                        signal,
                    );
                } catch (error) {
                    throw new ContainerStopped(String(error));
                }
            }
            await waitForStartup(
                async () => {
                    const status = await winboat.containerMgr!.getStatus();
                    if (status === ContainerStatus.UNKNOWN) return "unknown";
                    if (status !== ContainerStatus.RUNNING) return "stopped";
                    if (winboat.isUpdatingGuestServer.value) return "updating";
                    return winboat.guestReady.value ? "ready" : "waiting";
                },
                signal,
                status =>
                    publish({
                        ...base,
                        kind: "starting",
                        message:
                            status === "unknown"
                                ? "Checking Windows…"
                                : status === "updating"
                                  ? "Updating the WinBoat guest service…"
                                  : "Waiting for the WinBoat guest service…",
                    }),
            );
            signal.throwIfAborted();
            publish({ ...base, kind: "starting", message: "Checking application…" });
            if (![InternalApps.WINDOWS_DESKTOP, "NOVNC_COMMAND"].includes(shortcut.app.Path)) {
                let result: { status: string };
                try {
                    const res = await nodeFetch(`${WINBOAT_API_URL}/apps/validate`, {
                        method: "POST",
                        headers: { ...guestAuthHeaders(), "Content-Type": "application/json" },
                        body: JSON.stringify({ path: shortcut.app.Path, args: shortcut.app.Args }),
                        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
                    });
                    if (!res.ok) throw new Error(`Application check failed: HTTP ${res.status}`);
                    result = (await res.json()) as { status: string };
                    if (!["missing", "valid", "unknown"].includes(result?.status))
                        throw new Error("The guest service returned an unexpected response.");
                } catch (error) {
                    signal.throwIfAborted();
                    throw new GuestServiceError(
                        "The WinBoat guest service could not verify this application. It may be unreachable or need updating.",
                        { cause: error },
                    );
                }
                signal.throwIfAborted();
                if (result.status === "missing") {
                    const action = await ask({
                        ...base,
                        kind: "missing",
                        message: "This app could not be found. It may have been uninstalled.",
                    });
                    if (action === "remove") deleteShortcut(id);
                    return;
                }
            }
            signal.throwIfAborted();
            await winboat.launchApp(
                { ...shortcut.app, Args: [shortcut.app.Args, shortcut.extraArgs].filter(Boolean).join(" ") },
                signal,
            );
            signal.throwIfAborted();
            publish({ ...base, kind: "launched", message: `Launch requested for ${shortcut.name}` });
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (state?.kind !== "launched" && !signal.aborted)
                await new Promise<LaunchAction>(resolve => {
                    answer = resolve;
                });
        } catch (error) {
            if (!signal.aborted) {
                logger.error(error);
                let kind: LaunchState["kind"] = "error";
                let message = "WinBoat couldn’t open this shortcut.";
                let detail: string | undefined = String(error);
                if (error instanceof ContainerStopped) {
                    kind = "container-error";
                    message = "The Windows container failed to start or stopped unexpectedly.";
                } else if (error instanceof GuestTimeout) {
                    kind = "guest-error";
                    message =
                        "We couldn’t reach the WinBoat guest service. The service may not be running, or Windows may still be starting or installing updates.";
                    detail = undefined;
                } else if (error instanceof GuestServiceError) {
                    kind = "guest-error";
                    message = error.message;
                    detail = error.cause ? String(error.cause) : undefined;
                } else if (error instanceof ContainerStatusTimeout) {
                    message = error.message;
                    detail = undefined;
                }
                await ask({
                    kind,
                    name: shortcut?.name ?? "WinBoat",
                    icon: shortcut?.app.Icon,
                    message,
                    detail,
                });
            }
        } finally {
            answer = null;
            controller = null;
            activeAppName = null;
            publish(null);
        }
    }

    async function drain() {
        if (activeId !== null) return;
        while (queue.length) {
            activeId = queue.shift()!;
            await launch(activeId);
            activeId = null;
        }
    }

    function enqueue(id: string) {
        if (quitting || id === activeId || queue.includes(id)) return;
        queue.push(id);
        void drain();
    }
    ipcRenderer.on("shortcut:launch", (_event, id: string) => enqueue(id));

    async function quit(shutdown = winboat ? WinboatConfig.getInstance().config.shutdownOnQuit : false) {
        if (quitting) return;
        quitting = true;
        queue.length = 0;
        controller?.abort();
        answer?.("cancel");
        try {
            if (shutdown && winboat) {
                await winboat.waitForContainerAction();
                const status = await winboat.containerMgr!.getStatus();
                if (status === ContainerStatus.PAUSED) await winboat.unpauseContainer();
                if (![ContainerStatus.EXITED, ContainerStatus.UNKNOWN].includes(status)) await winboat.stopContainer();
            }
            exitApp();
        } catch (error) {
            const status = await winboat?.containerMgr?.getStatus();
            if (status === ContainerStatus.UNKNOWN || status === ContainerStatus.EXITED) {
                exitApp();
                return;
            }
            quitting = false;
            desktopFailure.value = {
                kind: "container-error",
                name: "WinBoat",
                message: "Windows could not be shut down. WinBoat is still running.",
                detail: String(error),
            };
            performWindowAction("show");
        }
    }

    ipcRenderer.on("window:closing", async (_event, action: "close" | "quit") => {
        if (quitting || closePromptOpen) return;
        closePromptOpen = true;
        try {
            if (action === "close" && winboat) {
                const config = WinboatConfig.getInstance().config;
                if (config.closeAction === "ask") {
                    const result = await showMessageBox({
                        type: "question",
                        title: "Keep WinBoat in the tray?",
                        message: "What should happen when you close the WinBoat window?",
                        detail: "You can change this later in Settings.",
                        buttons: ["Keep in tray", "Quit WinBoat", "Cancel"],
                        defaultId: 0,
                        cancelId: 2,
                    });
                    if (result.response === 2 || quitting) return;
                    config.closeAction = result.response === 0 ? "tray" : "quit";
                }
                if (config.closeAction === "tray" && hasTray) {
                    performWindowAction("hide");
                    return;
                }
            }
            await quit();
        } catch (error) {
            desktopFailure.value = {
                kind: "error",
                name: "WinBoat",
                message: "Could not close WinBoat.",
                detail: String(error),
            };
            performWindowAction("show-error");
        } finally {
            closePromptOpen = false;
        }
    });

    const info: {
        isPackaged: boolean;
        executable: string;
        hasTray: boolean;
        shortcutLaunch: boolean;
        shortcuts: string[];
    } = await ipcRenderer.invoke("desktop:ready");
    hasTray = info.hasTray;
    info.shortcuts.forEach(enqueue);
    if (!winboat) {
        performWindowAction("show");
        return;
    }
    try {
        refreshShortcuts();
        if (info.isPackaged && !info.shortcutLaunch) {
            const current = detectLauncher(process.env, info.executable);
            const previous = readLauncher();
            if (previous && shortcuts.value.length && JSON.stringify(previous) !== JSON.stringify(current)) {
                const result = await showMessageBox({
                    type: "question",
                    title: "Update your shortcuts?",
                    message:
                        "We detected that you're using a different version of WinBoat from what your shortcuts point to. Would you like to update them?",
                    detail: `Current: ${[previous.executable, ...previous.args].join(" ")}\nNew: ${[current.executable, ...current.args].join(" ")}`,
                    buttons: ["Update shortcuts", "Keep current version"],
                    defaultId: 0,
                    cancelId: 1,
                });
                if (result.response !== 0) return;
            }
            writeLauncher(current);
        }
    } catch (error) {
        desktopFailure.value = {
            kind: "error",
            name: "WinBoat",
            message: "Could not update shortcut launcher.",
            detail: String(error),
        };
        performWindowAction("show-error");
    }
}

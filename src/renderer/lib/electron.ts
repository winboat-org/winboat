import type { OpenDialogOptions, OpenDialogReturnValue } from "electron";

const { ipcRenderer }: typeof import("electron") = require("electron");

type WindowAction = "close" | "toggle-maximize" | "minimize";
let appPath: string | null = null;

export async function initializeAppPath() {
    appPath = await ipcRenderer.invoke("app:get-app-path");
}

export function getAppPath(): string {
    if (appPath === null) {
        throw new Error("Electron app path was accessed before it was initialized");
    }

    return appPath;
}

export function performWindowAction(action: WindowAction) {
    ipcRenderer.send("window:action", action);
}

export function showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
    return ipcRenderer.invoke("dialog:show-open", options);
}

export function openExternal(link: string): Promise<void> {
    return ipcRenderer.invoke("shell:open-external", link);
}

export function showItemInFolder(path: string): Promise<void> {
    return ipcRenderer.invoke("shell:show-item-in-folder", path);
}

export function openPath(path: string): Promise<string> {
    return ipcRenderer.invoke("shell:open-path", path);
}

export function exitApp() {
    ipcRenderer.send("app:exit");
}

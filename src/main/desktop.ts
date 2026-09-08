import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";

let mainWindow: BrowserWindow;
let launchWindow: BrowserWindow | null = null;
let launchState: unknown = null;
let tray: Tray | null = null;
let ready = false;
let quitting = false;
const pending: string[] = [];

export function shortcutArgument(args: string[]): string | null {
    const index = args.indexOf("--shortcut");
    return index < 0 ? null : args[index + 1] || "";
}

function showMainWindow() {
    mainWindow?.show();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
}

export function receiveLaunch(id: string | null) {
    if (quitting) return;
    if (id === null) showMainWindow();
    else if (ready) mainWindow.webContents.send("shortcut:launch", id);
    else if (!pending.includes(id)) pending.push(id);
}

export function quitApp() {
    quitting = true;
    app.quit();
}

function requestClose(action: "close" | "quit") {
    if (ready) mainWindow.webContents.send("window:closing", action);
    else quitApp();
}

export function setupDesktop(
    window: BrowserWindow,
    loadWindow: (window: BrowserWindow, shortcut?: boolean) => void,
    initialShortcut: string | null,
) {
    mainWindow = window;
    window.webContents.on("did-start-loading", () => {
        ready = false;
    });
    window.on("close", event => {
        if (quitting) return;
        event.preventDefault();
        requestClose("close");
    });
    app.on("before-quit", event => {
        if (quitting) return;
        event.preventDefault();
        requestClose("quit");
    });
    try {
        const icon = nativeImage.createFromPath(
            join(
                app.getAppPath(),
                app.isPackaged ? "renderer/img/winboat_logo.png" : "../../src/renderer/public/img/winboat_logo.png",
            ),
        );
        tray = new Tray(icon.resize({ width: 24, height: 24 }));
        tray.setToolTip("WinBoat");
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: "Open WinBoat", click: showMainWindow },
                { type: "separator" },
                { label: "Quit WinBoat", click: () => requestClose("quit") },
            ]),
        );
        tray.on("click", showMainWindow);
    } catch (error) {
        console.warn("Could not create the WinBoat tray icon", error);
        window.show();
    }
    receiveLaunch(initialShortcut);
    ipcMain.handle("desktop:ready", () => {
        ready = true;
        return {
            isPackaged: app.isPackaged,
            executable: process.execPath,
            hasTray: !!tray,
            shortcutLaunch: initialShortcut !== null,
            shortcuts: pending.splice(0),
        };
    });
    ipcMain.handle("shortcut:state", () => launchState);
    ipcMain.on("shortcut:action", (_event, action: string) => mainWindow.webContents.send("shortcut:action", action));
    ipcMain.on("shortcut:state", (_event, state: unknown) => {
        launchState = state;
        if (!state) {
            const previous = launchWindow;
            launchWindow = null;
            previous?.close();
            return;
        }
        const height = typeof state === "object" && "kind" in state && state.kind === "launched" ? 200 : 280;
        if (!launchWindow) {
            const popup = new BrowserWindow({
                width: 600,
                height,
                resizable: false,
                maximizable: false,
                frame: false,
                show: false,
                backgroundColor: "#171717",
                webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
            });
            launchWindow = popup;
            popup.on("closed", () => {
                if (launchWindow !== popup) return;
                launchWindow = null;
                if (!quitting && !mainWindow.isDestroyed()) mainWindow.webContents.send("shortcut:action", "cancel");
            });
            popup.once("ready-to-show", () => {
                if (launchWindow === popup) popup.show();
            });
            loadWindow(popup, true);
        } else if (launchWindow.getContentSize()[1] !== height) {
            launchWindow.setContentSize(600, height);
        }
        launchWindow.webContents.send("shortcut:state", state);
    });
}

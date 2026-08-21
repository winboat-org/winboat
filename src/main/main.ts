import { app, BrowserWindow, ipcMain, session, dialog, shell, type OpenDialogOptions } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Avoid a dedicated network utility process.
app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess2");

// Match the only Chromium locale included in production packages.
app.commandLine.appendSwitch("lang", "en-US");

// Window Constants
const WINDOW_MIN_WIDTH = 1280;
const WINDOW_MIN_HEIGHT = 800;

type WindowState = {
    dimensions: {
        width: number;
        height: number;
    };
    position?: {
        x: number;
        y: number;
    };
};

const defaultWindowState: WindowState = {
    dimensions: {
        width: WINDOW_MIN_WIDTH,
        height: WINDOW_MIN_HEIGHT,
    },
};

function windowStatePath() {
    // Keep electron-store's former default path so existing users retain their window state.
    return join(app.getPath("userData"), "config.json");
}

function readWindowState(): WindowState {
    try {
        const state = JSON.parse(readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>;
        const width = state.dimensions?.width;
        const height = state.dimensions?.height;
        const x = state.position?.x;
        const y = state.position?.y;

        return {
            dimensions: {
                width: Number.isFinite(width) ? Number(width) : WINDOW_MIN_WIDTH,
                height: Number.isFinite(height) ? Number(height) : WINDOW_MIN_HEIGHT,
            },
            position:
                Number.isFinite(x) && Number.isFinite(y)
                    ? {
                          x: Number(x),
                          y: Number(y),
                      }
                    : undefined,
        };
    } catch {
        return defaultWindowState;
    }
}

function writeWindowState(window: BrowserWindow) {
    const { width, height, x, y } = window.getBounds();
    const state: WindowState = {
        dimensions: {
            width,
            height,
        },
        position: {
            x,
            y,
        },
    };

    try {
        writeFileSync(windowStatePath(), JSON.stringify(state), "utf8");
    } catch (error) {
        console.warn("Could not persist the WinBoat window state", error);
    }
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
    if (!app.requestSingleInstanceLock()) {
        // @ts-ignore property "window" is optional, see: [dialog.showMessageBoxSync](https://www.electronjs.org/docs/latest/api/dialog#dialogshowmessageboxsyncwindow-options)
        dialog.showMessageBoxSync(null, {
            type: "error",
            buttons: ["Close"],
            title: "WinBoat",
            message: "An instance of WinBoat is already running.\n\tMultiple Instances are not allowed.",
        });
        app.exit();
    }

    const windowState = readWindowState();

    mainWindow = new BrowserWindow({
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        width: windowState.dimensions.width,
        height: windowState.dimensions.height,
        x: windowState.position?.x,
        y: windowState.position?.y,
        transparent: false,
        frame: false,
        webPreferences: {
            // preload: join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.on("close", () => {
        if (mainWindow) writeWindowState(mainWindow);
    });

    if (process.env.NODE_ENV === "development") {
        const rendererPort = process.argv[2];
        mainWindow.loadURL(`http://localhost:${rendererPort}`);
    } else {
        mainWindow.loadFile(join(app.getAppPath(), "renderer", "index.html"));
    }
}

app.whenReady().then(() => {
    createWindow();

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                // 'Content-Security-Policy': ['script-src \'self\'']
                "Content-Security-Policy": [
                    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'",
                    "worker-src 'self' blob:",
                    "media-src 'self' blob:",
                    "font-src 'self' 'unsafe-inline' https://fonts.gstatic.com;",
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                ],
            },
        });
    });

    app.on("activate", function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", _ => {
    if (mainWindow) {
        mainWindow.focus();
    }
});

ipcMain.on("message", (_event, message) => {
    console.log(message);
});

ipcMain.on("window:action", (event, action: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    switch (action) {
        case "close":
            window.close();
            break;
        case "toggle-maximize":
            window.isMaximized() ? window.unmaximize() : window.maximize();
            break;
        case "minimize":
            window.minimize();
            break;
    }
});

ipcMain.handle("dialog:show-open", (event, options: OpenDialogOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
});

ipcMain.handle("shell:open-external", (_event, link: string) => {
    const url = new URL(link);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Refusing to open unsupported URL protocol: ${url.protocol}`);
    }
    return shell.openExternal(url.toString());
});

ipcMain.handle("shell:show-item-in-folder", (_event, path: string) => shell.showItemInFolder(path));
ipcMain.handle("shell:open-path", (_event, path: string) => shell.openPath(path));
ipcMain.handle("app:get-app-path", () => app.getAppPath());
ipcMain.on("app:exit", () => app.exit());

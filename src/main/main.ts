import { app, BrowserWindow, ipcMain, session, dialog, screen, type Display, type Rectangle } from "electron";
import { join } from "path";
import { initialize, enable } from "@electron/remote/main/index.js";
import Store from "electron-store";

initialize();

// Window Constants
// Default geometry for a fresh install (also used as the electron-store fallback).
const WINDOW_DEFAULT_WIDTH = 1280;
const WINDOW_DEFAULT_HEIGHT = 800;
// Absolute lower bounds, so the window stays usable even on tiny work areas.
const WINDOW_MIN_WIDTH_FLOOR = 360;
const WINDOW_MIN_HEIGHT_FLOOR = 280;
// Upper bounds for the computed minimum size. The minimum must never exceed
// half of the work area, otherwise tiling WMs cannot snap the window to a
// left/right half of the screen.
const WINDOW_MIN_WIDTH_CAP = 640;
const WINDOW_MIN_HEIGHT_CAP = 480;

// For electron-store Type-Safety
type SchemaType = {
    dimensions: {
        width: number;
        height: number;
    };
    position: {
        x: number;
        y: number;
    };
};

const windowStore = new Store<SchemaType>({
    schema: {
        dimensions: {
            type: "object",
            properties: {
                width: {
                    type: "number",
                    default: WINDOW_DEFAULT_WIDTH,
                },
                height: {
                    type: "number",
                    default: WINDOW_DEFAULT_HEIGHT,
                },
            },
            required: ["width", "height"],
        },
        position: {
            type: "object",
            properties: {
                x: {
                    type: "number",
                },
                y: {
                    type: "number",
                },
            },
            required: ["x", "y"],
        },
    },
});

let mainWindow: BrowserWindow | null = null;

// The window must be resizable down to (at most) half of the work area, so
// tiling window managers can snap it to a left/right half of the screen.
function computeMinSize(display: Display = screen.getPrimaryDisplay()) {
    const { workAreaSize } = display;

    return {
        minW: Math.max(WINDOW_MIN_WIDTH_FLOOR, Math.min(Math.floor(workAreaSize.width / 2), WINDOW_MIN_WIDTH_CAP)),
        minH: Math.max(WINDOW_MIN_HEIGHT_FLOOR, Math.min(Math.floor(workAreaSize.height / 2), WINDOW_MIN_HEIGHT_CAP)),
    };
}

// Keep a (possibly remembered) geometry inside the work area of the display it
// belongs to, so the window never opens off-screen after a resolution, scale or
// monitor change.
function clampToWorkArea(width: number, height: number, x?: number, y?: number) {
    const hasPosition = typeof x === "number" && typeof y === "number";
    const saved: Rectangle = { x: x ?? 0, y: y ?? 0, width, height };
    // Prefer the display the window was last on, so windows on a secondary
    // monitor aren't dragged back to the primary one.
    const display = hasPosition ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay();
    const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
    const { minW, minH } = computeMinSize(display);

    const w = Math.min(Math.max(width, minW), ww);
    const h = Math.min(Math.max(height, minH), wh);
    // Center on the target display if there is no remembered position.
    const px = hasPosition ? x : Math.round(wx + (ww - w) / 2);
    const py = hasPosition ? y : Math.round(wy + (wh - h) / 2);
    // Clamp the top-left corner so the whole window stays inside the work area.
    const cx = Math.min(Math.max(px, wx), wx + ww - w);
    const cy = Math.min(Math.max(py, wy), wy + wh - h);

    return { x: cx, y: cy, width: w, height: h };
}

// Re-fit the window whenever the display configuration changes (monitor
// plug/unplug, resolution or scale change).
function reflowWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    try {
        const bounds = mainWindow.getBounds();
        const geometry = clampToWorkArea(bounds.width, bounds.height, bounds.x, bounds.y);
        const { minW, minH } = computeMinSize(screen.getDisplayMatching(geometry));

        mainWindow.setMinimumSize(minW, minH);

        // Leave maximized / fullscreen / minimized windows to the window manager.
        if (mainWindow.isMaximized() || mainWindow.isFullScreen() || mainWindow.isMinimized()) {
            return;
        }

        if (
            geometry.x !== bounds.x ||
            geometry.y !== bounds.y ||
            geometry.width !== bounds.width ||
            geometry.height !== bounds.height
        ) {
            mainWindow.setBounds(geometry);
        }
    } catch (error) {
        console.error("Failed to re-fit the WinBoat window after a display change:", error);
    }
}

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

    const geometry = clampToWorkArea(
        windowStore.get("dimensions.width"),
        windowStore.get("dimensions.height"),
        windowStore.get("position.x"),
        windowStore.get("position.y"),
    );
    const { minW, minH } = computeMinSize(screen.getDisplayMatching(geometry));

    mainWindow = new BrowserWindow({
        ...geometry,
        minWidth: minW,
        minHeight: minH,
        resizable: true,
        maximizable: true,
        fullscreenable: true,
        type: "normal",
        transparent: false,
        frame: false,
        webPreferences: {
            // preload: join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.on("close", () => {
        const bounds = mainWindow?.getBounds();

        windowStore.set("dimensions", {
            width: bounds?.width,
            height: bounds?.height,
        });

        windowStore.set("position", {
            x: bounds?.x,
            y: bounds?.y,
        });
    });

    enable(mainWindow.webContents);

    if (process.env.NODE_ENV === "development") {
        const rendererPort = process.argv[2];
        mainWindow.loadURL(`http://localhost:${rendererPort}`);
    } else {
        mainWindow.loadFile(join(app.getAppPath(), "renderer", "index.html"));
    }
}

app.whenReady().then(() => {
    createWindow();

    screen.on("display-metrics-changed", reflowWindow);
    screen.on("display-added", reflowWindow);
    screen.on("display-removed", reflowWindow);

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

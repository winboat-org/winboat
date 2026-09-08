import { ref } from "vue";
import type { Launcher, Shortcut, WinApp } from "../../types";
import { WINBOAT_DIR, DATA_HOME } from "./constants";
const fs: typeof import("fs") = require("node:fs");
const process: typeof import("process") = require("node:process");
const { dirname, join, resolve }: typeof import("path") = require("node:path");
const { homedir }: typeof import("os") = require("node:os");
const { randomUUID }: typeof import("crypto") = require("node:crypto");

export const shortcuts = ref<Shortcut[]>([]);
export const refreshShortcuts = () => {
    shortcuts.value = readShortcuts();
};
export const shortcutFor = (app: WinApp) => shortcuts.value.find(item => appKey(item.app) === appKey(app));

export function appKey(app: Pick<WinApp, "Path" | "Args">): string {
    return JSON.stringify([app.Path.replaceAll("/", "\\").toLowerCase(), app.Args || ""]);
}

function desktopDirectory(): string | null {
    const file = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "user-dirs.dirs");
    const match = fs.existsSync(file) && fs.readFileSync(file, "utf8").match(/^XDG_DESKTOP_DIR="(.*)"\s*$/m);
    if (!match) return join(homedir(), "Desktop");
    const value = match[1].replace(/^\$HOME(?=\/|$)/, homedir()).replace(/\\(["\\$`])/g, "$1");
    return value.startsWith("/") && resolve(value) !== homedir() ? value : null;
}

function writeAtomic(file: string, content: string | Buffer, mode = 0o600) {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, content, { mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, file);
}

function desktopValue(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t");
}

function desktopExec(value: string): string {
    if (/[\r\n\0]/.test(value)) throw new Error("Shortcut paths cannot contain line breaks.");
    return desktopValue(`"${value.replaceAll("%", "%%").replace(/["`$\\]/g, "\\$&")}"`);
}

export function detectLauncher(env: NodeJS.ProcessEnv, executable: string): Launcher {
    if (env.APPIMAGE) return { type: "appimage", executable: env.APPIMAGE, args: [] };
    if (env.FLATPAK_ID === "com.teabox.winboat") {
        return { type: "flatpak", executable: "flatpak", args: ["run", env.FLATPAK_ID] };
    }
    return { type: "bin", executable, args: [] };
}

export function readLauncher(directory = WINBOAT_DIR): Launcher | null {
    const file = join(directory, "launcher.conf");
    if (!fs.existsSync(file)) return null;
    const [type, executable, ...args] = fs.readFileSync(file, "utf8").replace(/\n$/, "").split("\n");
    if (!["appimage", "flatpak", "bin"].includes(type) || !executable)
        throw new Error("Invalid shortcut launcher configuration.");
    return { type: type as Launcher["type"], executable, args };
}

const launcherScript = `#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
    echo "Usage: launch SHORTCUT_ID" >&2
    exit 1
fi
shortcut_id=$1
launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
set --
{
    IFS= read -r launcher_type
    while IFS= read -r argument; do
        set -- "$@" "$argument"
    done
} < "$launcher_dir/launcher.conf"
exec "$@" --shortcut "$shortcut_id"
`;

export function writeLauncher(launcher: Launcher, directory = WINBOAT_DIR) {
    const lines = [launcher.type, launcher.executable, ...launcher.args];
    if (lines.some(line => /[\n\r\0]/.test(line))) throw new Error("Launcher arguments cannot contain line breaks.");
    fs.mkdirSync(directory, { recursive: true });
    writeAtomic(join(directory, "launcher.conf"), lines.join("\n") + "\n");
    writeAtomic(join(directory, "launch"), launcherScript, 0o700);
}

export function readShortcuts(directory = WINBOAT_DIR): Shortcut[] {
    const file = join(directory, "shortcuts.json");
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.version !== 1 || !Array.isArray(data.shortcuts)) throw new Error("Unsupported shortcuts file.");
    return data.shortcuts;
}

function writeShortcuts(directory: string, records: Shortcut[]) {
    writeAtomic(join(directory, "shortcuts.json"), JSON.stringify({ version: 1, shortcuts: records }, null, 4));
    shortcuts.value = records;
}

function removeOwnedFile(file: string, id: string) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").split("\n").includes(`X-WinBoat-Shortcut=${id}`)) {
        fs.unlinkSync(file);
    }
}

export function saveShortcut(
    input: Pick<Shortcut, "app" | "name" | "extraArgs" | "destination">,
    directory = WINBOAT_DIR,
    applicationsDir = join(DATA_HOME, "applications"),
    desktopDir = desktopDirectory(),
): Shortcut {
    if (!input.name.trim() || !input.app.Path) throw new Error("A name and application target are required.");
    if (!["desktop", "applications", "both"].includes(input.destination))
        throw new Error("Choose a shortcut location.");
    if (input.destination !== "applications" && !desktopDir)
        throw new Error("Your desktop folder is disabled. Choose Applications menu instead.");
    const records = readShortcuts(directory);
    const previous = records.find(shortcut => appKey(shortcut.app) === appKey(input.app));
    const id = previous?.id ?? randomUUID();
    const filename = `winboat-${id}.desktop`;
    const files = [
        ...(input.destination !== "desktop" ? [join(applicationsDir, filename)] : []),
        ...(input.destination !== "applications" ? [join(desktopDir!, filename)] : []),
    ];
    const shortcut: Shortcut = { ...input, name: input.name.trim(), id, files };
    const iconDir = join(directory, "shortcut-icons");
    fs.mkdirSync(iconDir, { recursive: true });
    const icon = join(iconDir, `${id}.png`);
    const iconData = input.app.Icon.replace(/^data:image\/png(?:;charset=utf-8)?;base64,/, "");
    writeAtomic(icon, Buffer.from(iconData, "base64"), 0o644);
    const content = [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${desktopValue(shortcut.name)}`,
        `Exec=${desktopExec(join(directory, "launch"))} ${id}`,
        `Icon=${desktopValue(icon)}`,
        "Terminal=false",
        "Categories=Utility;",
        `X-WinBoat-Shortcut=${id}`,
        "",
    ].join("\n");
    for (const file of files) {
        fs.mkdirSync(dirname(file), { recursive: true });
        writeAtomic(file, content, 0o755);
    }
    writeShortcuts(directory, [...records.filter(item => item.id !== id), shortcut]);
    previous?.files.filter(file => !files.includes(file)).forEach(file => removeOwnedFile(file, id));
    return shortcut;
}

export function deleteShortcut(id: string, directory = WINBOAT_DIR) {
    const records = readShortcuts(directory);
    const shortcut = records.find(item => item.id === id);
    if (!shortcut) return;
    for (const file of shortcut.files) removeOwnedFile(file, id);
    const icon = join(directory, "shortcut-icons", `${id}.png`);
    if (fs.existsSync(icon)) fs.unlinkSync(icon);
    writeShortcuts(
        directory,
        records.filter(item => item.id !== id),
    );
}

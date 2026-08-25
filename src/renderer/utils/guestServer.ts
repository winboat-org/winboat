import { GUEST_TOKEN_PATH } from "../lib/constants";
import { getAppPath } from "../lib/electron";

const fs: typeof import("fs") = require("node:fs");
const path: typeof import("path") = require("node:path");
const process: typeof import("process") = require("node:process");

/**
 * Base directory of the bundled guest server resources. In a packaged app this
 * is `resources/guest_server`; in dev it's the build output under
 * `guest_server/dist`. Both hold the same layout: `oem/` and `update/`.
 */
export function guestServerResourceDir(): string {
    return import.meta.env.PROD
        ? path.join(process.resourcesPath, "guest_server")
        : path.join(getAppPath(), "..", "..", "guest_server", "dist");
}

/** The OEM payload that gets copied into the guest's `C:\OEM` mount at install. */
export function guestServerOemDir(): string {
    return path.join(guestServerResourceDir(), "oem");
}

/** The update zip pushed to the Guest Server Updater to update the Guest Server. */
export function guestServerUpdateZipPath(): string {
    return path.join(guestServerResourceDir(), "update", "winboat_guest_server.zip");
}

/**
 * Authorization headers for requests to the guest services.
 */
export function guestAuthHeaders(): Record<string, string> {
    try {
        const token = fs.readFileSync(GUEST_TOKEN_PATH, "utf8").trim();
        return { Authorization: `Bearer ${token}` };
    } catch {
        return {};
    }
}

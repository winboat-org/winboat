const crypto: typeof import("node:crypto") = require("node:crypto");
import type { WinApp } from "../../types";

/**
 * SHA-256 of the transparent 256x256 PNG that guest_server/scripts/get-icon.ps1
 * emits when icon extraction fails on the Windows side. Apps shipping this icon
 * render the WinBoat logo instead of their own, so the host flags them to make
 * otherwise-silent extraction failures visible in winboat.log.
 *
 * Re-compute after changing the fallback PNG in get-icon.ps1:
 *   sha256 of the decoded $defaultIconBase64 bytes.
 */
export const FALLBACK_ICON_SHA256 = "ec131e284727b230c5cf7854e6673fa65c1a5387b66869e0b957396aebb4689d";

function isFallbackIcon(icon: string, fallbackSha256: string): boolean {
    try {
        const digest = crypto.createHash("sha256").update(Buffer.from(icon, "base64")).digest("hex");
        return digest === fallbackSha256;
    } catch {
        return false;
    }
}

/**
 * Returns apps whose Icon is empty or is the guest-server transparent fallback,
 * i.e. every app that will render the WinBoat logo instead of its own icon.
 * Pass a custom `fallbackSha256` to test the detection without the real blob.
 */
export function findAppsWithoutIcon(apps: WinApp[], fallbackSha256: string = FALLBACK_ICON_SHA256): WinApp[] {
    return apps.filter(app => !app.Icon?.trim() || isFallbackIcon(app.Icon, fallbackSha256));
}

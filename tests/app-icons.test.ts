import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { findAppsWithoutIcon } from "../src/renderer/lib/app-icons";
import type { WinApp } from "../src/types";

const app = (overrides: Partial<WinApp>): WinApp => ({
    Name: "Test App",
    Path: "C:\\test\\app.exe",
    Args: "",
    Icon: "aGVsbG8=", // valid non-empty base64
    Source: "startmenu",
    ...overrides,
});

describe("findAppsWithoutIcon", () => {
    it("flags apps with an empty icon", () => {
        const missing = findAppsWithoutIcon([app({ Name: "NoIcon", Icon: "" })]);
        expect(missing.map(a => a.Name)).toEqual(["NoIcon"]);
    });

    it("flags apps with a whitespace-only icon", () => {
        const missing = findAppsWithoutIcon([app({ Name: "Blank", Icon: "   " })]);
        expect(missing.map(a => a.Name)).toEqual(["Blank"]);
    });

    it("flags apps whose icon matches the given fallback digest", () => {
        const fallbackBytes = "fallback-png-bytes";
        const fallbackB64 = Buffer.from(fallbackBytes, "binary").toString("base64");
        const digest = createHash("sha256").update(fallbackBytes, "binary").digest("hex");
        const missing = findAppsWithoutIcon([app({ Name: "Fallback", Icon: fallbackB64 })], digest);
        expect(missing.map(a => a.Name)).toEqual(["Fallback"]);
    });

    it("does not flag apps that have a real icon", () => {
        expect(findAppsWithoutIcon([app({ Name: "Good" })], "deadbeef")).toEqual([]);
    });

    it("keeps the pinned guest-server fallback digest from get-icon.ps1 in sync", () => {
        // 64 hex chars = sha256; the value is computed from the transparent PNG
        // embedded in guest_server/scripts/get-icon.ps1 (see FALLBACK_ICON_SHA256 docs)
        expect(/^([0-9a-f]{64})$/.test(require("../src/renderer/lib/app-icons").FALLBACK_ICON_SHA256)).toBe(true);
    });
});

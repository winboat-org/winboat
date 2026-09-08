import { describe, expect, it } from "bun:test";
import {
    ContainerStatusTimeout,
    ContainerStopped,
    GuestTimeout,
    waitForStartup,
} from "../src/renderer/lib/shortcut-startup";

describe("shortcut startup", () => {
    it("waits through guest startup and updates before launching", async () => {
        const states = ["unknown", "waiting", "unknown", "updating", "ready"] as const;
        let index = 0;
        const progress: string[] = [];
        await waitForStartup(
            async () => states[index++],
            new AbortController().signal,
            status => progress.push(status),
            500,
            1,
        );
        expect(index).toBe(5);
        expect(progress).toEqual(["unknown", "waiting", "unknown", "updating"]);
    });

    it("reports container death immediately", async () => {
        await expect(
            waitForStartup(
                async () => "stopped",
                new AbortController().signal,
                () => {},
            ),
        ).rejects.toBeInstanceOf(ContainerStopped);
    });

    it("reports an unresponsive initial status check as an unknown status", async () => {
        await expect(
            waitForStartup(
                () => new Promise(() => {}),
                new AbortController().signal,
                () => {},
                20,
                1,
            ),
        ).rejects.toBeInstanceOf(ContainerStatusTimeout);
    });

    it("does not mistake cancellation for an unreachable guest", async () => {
        const controller = new AbortController();
        const pending = waitForStartup(
            () => new Promise(() => {}),
            controller.signal,
            () => {},
            500,
            1,
        );
        controller.abort(new Error("cancelled"));
        await expect(pending).rejects.toThrow("cancelled");
    });

    it("times out a guest that keeps answering not ready", async () => {
        await expect(
            waitForStartup(
                async () => "waiting",
                new AbortController().signal,
                () => {},
                20,
                1,
            ),
        ).rejects.toBeInstanceOf(GuestTimeout);
    });

    it("retries unknown statuses until the deadline and reports the status failure", async () => {
        let checks = 0;
        await expect(
            waitForStartup(
                async () => {
                    checks++;
                    return "unknown";
                },
                new AbortController().signal,
                () => {},
                30,
                1,
            ),
        ).rejects.toThrow("Couldn’t determine Windows’ status.");
        expect(checks).toBeGreaterThan(1);
    });

    it("reports the guest timeout if status recovers but the guest stays unavailable", async () => {
        let checks = 0;
        await expect(
            waitForStartup(
                async () => (checks++ === 0 ? "unknown" : "waiting"),
                new AbortController().signal,
                () => {},
                30,
                1,
            ),
        ).rejects.toBeInstanceOf(GuestTimeout);
    });

    it("reports an unknown status if inspection fails while waiting for the guest", async () => {
        let checks = 0;
        await expect(
            waitForStartup(
                async () => (checks++ === 0 ? "waiting" : "unknown"),
                new AbortController().signal,
                () => {},
                30,
                1,
            ),
        ).rejects.toBeInstanceOf(ContainerStatusTimeout);
    });

    it("preserves cancellation while retrying an unknown status", async () => {
        const controller = new AbortController();
        await expect(
            waitForStartup(
                async () => "unknown",
                controller.signal,
                () => controller.abort(new Error("cancelled")),
                500,
                1,
            ),
        ).rejects.toThrow("cancelled");
    });
});

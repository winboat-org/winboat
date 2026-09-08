import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

function check(scenario: string, runtime = "Docker") {
    // Isolate module mocks, singleton config, timers and IPC listeners from other tests.
    const result = spawnSync(
        process.execPath,
        [new URL("./fixtures/lifecycle.ts", import.meta.url).pathname, scenario, runtime],
        {
            encoding: "utf8",
            timeout: 10000,
        },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
}

describe("guest readiness", () => {
    for (const scenario of ["version-retry", "health-retry", "single-version-check", "stop-during-version-check"])
        it(scenario, () => check(scenario));
});

for (const runtime of ["Docker", "Podman"]) {
    describe(`${runtime} lifecycle`, () => {
        for (const scenario of [
            "clean-exit",
            "failed-exit",
            "oom-exit",
            "unreadable-exit",
            "exit-after-unknown",
            "dashboard-stop",
            "quit-unavailable",
            "quit-runtime-lost",
            "quit-already-stopped",
            "quit-stop-failure",
            "quit-without-shutdown",
            "quit-paused",
        ])
            it(scenario, () => check(scenario, runtime));
    });
}

it("waits for Podman's final exit result while stopping", () => check("podman-stopping", "Podman"));

describe("fresh setup", () => {
    for (const step of ["createComposeFile", "startContainer", "monitorContainerPreinstall"])
        it(`keeps ${step} errors in setup`, () => check(`install-${step}`));
    it("can close without a working runtime", () => check("setup-close"));
});

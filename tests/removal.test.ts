import { describe, expect, it, mock } from "bun:test";
import type { RemovalDeps, RemovalSummary } from "../src/renderer/lib/removal";

// Keep the test output pristine: swap in a consola whose console reporters are stripped.
// The file reporter that `createLogger` adds afterwards is untouched, so removal.log is
// still written by the real logging code under test.
const realCreateConsola: typeof import("consola").createConsola = require("consola").createConsola;

mock.module("consola", () => ({
    createConsola: (options: Parameters<typeof realCreateConsola>[0]) => {
        const instance = realCreateConsola(options);
        // Drop the default console reporters; `createLogger` adds its file reporter afterwards
        (instance as { options: { reporters: unknown[] } }).options.reporters = [];
        return instance;
    },
}));

const {
    REMOVAL_STEP_DESCRIPTIONS,
    REMOVAL_STEP_ORDER,
    REMOVAL_STEP_WEIGHTS,
    RemovalManager,
    RemovalStates,
    removalProgress,
} = await import("../src/renderer/lib/removal");
const { ContainerRuntimes } = await import("../src/renderer/lib/containers/common");

const fs: typeof import("fs") = require("node:fs");
const fsp: typeof import("fs/promises") = require("node:fs/promises");
const os: typeof import("os") = require("node:os");
const path: typeof import("path") = require("node:path");

/**
 * Builds a minimal compose file body like the one WinBoat writes at install time.
 * Only the `/storage` volume matters to the removal flow.
 */
function composeYaml(storageVolume: string): string {
    return `
services:
  windows:
    image: ghcr.io/dockur/windows:6.03
    container_name: WinBoat
    environment:
      VERSION: "11"
      RAM_SIZE: "4G"
      CPU_CORES: "4"
      DISK_SIZE: "64G"
      USERNAME: user
      PASSWORD: password
      HOME: /home
      LANGUAGE: "English"
      ARGUMENTS: ""
      HOST_PORTS: ""
    volumes:
      - "${storageVolume}"
`;
}

interface TestHarness {
    manager: RemovalManager;
    calls: { stop: number; remove: number; exec: string[] };
    dirs: { tmpRoot: string; winboatDir: string; storageDir: string };
    composeFilePath: string;
    events: {
        steps: { state: RemovalStates; index: number; total: number }[];
        logs: string[];
        errors: { state: RemovalStates; error: Error }[];
        completed: RemovalSummary[];
    };
    completedSummary: () => RemovalSummary;
    cleanup: () => Promise<void>;
}

interface HarnessOptions {
    /** The `/storage` entry of the compose file; defaults to the temp bind folder "<storageDir>:/storage" */
    storageVolume?: string;
    runtime?: ContainerRuntimes;
    /** Whether the bind folder on the host actually exists on disk (defaults to false) */
    createStorageFolder?: boolean;
    /** Whether to place a config marker file inside the WinBoat dir (defaults to false) */
    createWinboatMarker?: boolean;
    /** Whether the compose file exists at all (defaults to true) */
    composeFileExists?: boolean;
    /** Overrides the compose file body, e.g. to simulate an empty or malformed file */
    composeFileContent?: string;
    stopContainer?: RemovalDeps["stopContainer"];
    removeContainer?: RemovalDeps["removeContainer"];
    exec?: RemovalDeps["exec"];
}

async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "winboat-removal-test-"));
    const winboatDir = path.join(tmpRoot, "winboat");
    const storageDir = path.join(tmpRoot, "vm-storage");
    const composeFilePath = path.join(winboatDir, "docker-compose.yml");
    const storageVolume = options.storageVolume ?? `${storageDir}:/storage`;

    await fsp.mkdir(winboatDir, { recursive: true });

    if (options.composeFileExists ?? true) {
        await fsp.writeFile(composeFilePath, options.composeFileContent ?? composeYaml(storageVolume), "utf-8");
    }

    if (options.createStorageFolder) {
        await fsp.mkdir(storageDir, { recursive: true });
        await fsp.writeFile(path.join(storageDir, "data.img"), "fake windows disk");
    }

    if (options.createWinboatMarker) {
        await fsp.writeFile(path.join(winboatDir, "config.json"), "{}", "utf-8");
    }

    const calls = { stop: 0, remove: 0, exec: [] as string[] };

    const deps: RemovalDeps = {
        stopContainer:
            options.stopContainer ??
            (async () => {
                calls.stop++;
            }),
        removeContainer:
            options.removeContainer ??
            (async () => {
                calls.remove++;
            }),
        composeFilePath,
        runtime: options.runtime ?? ContainerRuntimes.DOCKER,
        winboatDir,
        ...(options.exec
            ? {
                  exec: async (cmd: string) => {
                      calls.exec.push(cmd);
                      return options.exec!(cmd);
                  },
              }
            : {}),
    };

    const manager = new RemovalManager(deps);

    const events = {
        steps: [] as { state: RemovalStates; index: number; total: number }[],
        logs: [] as string[],
        errors: [] as { state: RemovalStates; error: Error }[],
        completed: [] as RemovalSummary[],
    };

    manager.emitter.on("stepChanged", (state, index, total) => events.steps.push({ state, index, total }));
    manager.emitter.on("log", line => events.logs.push(line));
    manager.emitter.on("error", (state, error) => events.errors.push({ state, error }));
    manager.emitter.on("completed", summary => events.completed.push(summary));

    return {
        manager,
        calls,
        dirs: { tmpRoot, winboatDir, storageDir },
        composeFilePath,
        events,
        completedSummary: () => {
            expect(events.completed).toHaveLength(1);
            return events.completed[0];
        },
        cleanup: async () => {
            await fsp.rm(tmpRoot, { recursive: true, force: true });
        },
    };
}

describe("RemovalManager", () => {
    it("happy path: runs all 5 steps in order, emits stepChanged with index/total, then completed", async () => {
        const h = await createHarness({ createStorageFolder: true, createWinboatMarker: true });

        await h.manager.run();

        expect(h.events.steps.map(s => s.state)).toEqual(REMOVAL_STEP_ORDER);
        expect(h.events.steps.map(s => s.index)).toEqual([0, 1, 2, 3, 4]);
        expect(h.events.steps.every(s => s.total === REMOVAL_STEP_ORDER.length)).toBe(true);

        expect(h.calls.stop).toBe(1);
        expect(h.calls.remove).toBe(1);
        // A bind folder must be deleted with fs, not via `docker volume rm`
        expect(h.calls.exec).toEqual([]);

        expect(h.manager.state).toBe(RemovalStates.COMPLETED);
        expect(h.events.errors).toEqual([]);

        const summary = h.completedSummary();
        expect(summary.removed).toHaveLength(3);
        expect(summary.removed.some(entry => entry.includes(h.dirs.storageDir))).toBe(true);
        expect(summary.warnings).toEqual([]);

        // The storage bind folder is really gone from disk
        expect(fs.existsSync(h.dirs.storageDir)).toBe(false);
        // The WinBoat dir contents are gone (the removal.log reporter may recreate the dir itself)
        expect(fs.existsSync(path.join(h.dirs.winboatDir, "config.json"))).toBe(false);
        expect(fs.existsSync(path.join(h.dirs.winboatDir, "removal.log"))).toBe(true);
        // Log lines were emitted for the live UI panel as well
        expect(h.events.logs.length).toBeGreaterThan(0);

        await h.cleanup();
    });

    it("stopContainer rejection: emits error with the failing step, later steps not executed, no throw", async () => {
        const h = await createHarness({
            stopContainer: async () => {
                throw new Error("docker stop failed");
            },
        });

        let resolved = false;
        await (async () => {
            await h.manager.run();
            resolved = true;
        })();

        expect(resolved).toBe(true); // run() must not throw
        expect(h.events.errors).toHaveLength(1);
        expect(h.events.errors[0].state).toBe(RemovalStates.STOPPING_CONTAINER);
        expect(h.events.errors[0].error.message).toContain("docker stop failed");
        expect(h.calls.remove).toBe(0);
        expect(h.manager.state).toBe(RemovalStates.REMOVAL_ERROR);
        expect(h.events.completed).toHaveLength(0);

        await h.cleanup();
    });

    it("retry: run({ fromStep: REMOVING_STORAGE }) after a failure does not re-run earlier steps", async () => {
        let failStop = true;
        let stopCalls = 0;
        const h = await createHarness({
            createStorageFolder: true,
            stopContainer: async () => {
                stopCalls++;
                if (failStop) throw new Error("transient stop failure");
            },
        });

        await h.manager.run(); // first attempt fails at STOPPING_CONTAINER
        expect(h.manager.state).toBe(RemovalStates.REMOVAL_ERROR);

        const stepsBeforeRetry = h.events.steps.length;
        failStop = false;
        await h.manager.run({ fromStep: RemovalStates.REMOVING_STORAGE });

        const retrySteps = h.events.steps.slice(stepsBeforeRetry);
        expect(retrySteps.map(s => s.state)).toEqual([
            RemovalStates.REMOVING_STORAGE,
            RemovalStates.REMOVING_WINBOAT_DIR,
        ]);
        expect(retrySteps[0].index).toBe(REMOVAL_STEP_ORDER.indexOf(RemovalStates.REMOVING_STORAGE));
        expect(retrySteps[0].total).toBe(REMOVAL_STEP_ORDER.length);

        // Earlier steps were NOT re-run
        expect(stopCalls).toBe(1);
        expect(h.calls.remove).toBe(0);

        expect(h.manager.state).toBe(RemovalStates.COMPLETED);
        expect(h.events.completed).toHaveLength(1);
        expect(h.events.errors).toHaveLength(1); // only the original failure

        await h.cleanup();
    });

    it("re-entrancy: a second run() rejects while one is in flight, and running resets when it finishes", async () => {
        let resolveStop!: () => void;
        const stopDeferred = new Promise<void>(resolve => {
            resolveStop = resolve;
        });

        const h = await createHarness({
            createStorageFolder: true,
            stopContainer: () => stopDeferred,
        });

        let firstRunSettled = false;
        const firstRun = h.manager.run().then(() => {
            firstRunSettled = true;
        });

        // Wait until the first run is parked inside the never-resolving stopContainer
        for (let i = 0; i < 200 && h.manager.state !== RemovalStates.STOPPING_CONTAINER; i++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        expect(h.manager.state).toBe(RemovalStates.STOPPING_CONTAINER);
        expect(h.manager.running).toBe(true);

        // A concurrent run is a programmer error and must throw the contract exception
        await expect(h.manager.run()).rejects.toThrow("already in progress");
        expect(h.calls.remove).toBe(0);
        expect(h.events.steps.map(s => s.state)).toEqual([
            RemovalStates.PRECHECK,
            RemovalStates.STOPPING_CONTAINER,
        ]);

        resolveStop();
        await firstRun;
        expect(firstRunSettled).toBe(true);
        expect(h.manager.running).toBe(false);
        expect(h.manager.state).toBe(RemovalStates.COMPLETED);
        expect(h.events.completed).toHaveLength(1);

        // A fresh run is no longer rejected: it starts executing from PRECHECK again
        // (and fails there, because the first run already removed the compose file
        // together with the WinBoat dir). No "already in progress" rejection.
        await h.manager.run();
        expect(h.manager.running).toBe(false);
        expect(h.events.steps.at(-1)?.state).toBe(RemovalStates.PRECHECK);
        expect(h.events.errors.at(-1)?.state).toBe(RemovalStates.PRECHECK);

        await h.cleanup();
    });

    it("legacy named volume with DOCKER runtime: exec receives 'docker volume rm winboat_data'", async () => {
        const h = await createHarness({
            storageVolume: "data:/storage",
            runtime: ContainerRuntimes.DOCKER,
            exec: async () => ({ stdout: "", stderr: "" }),
        });

        await h.manager.run();

        expect(h.calls.exec).toEqual(["docker volume rm winboat_data"]);
        expect(h.manager.state).toBe(RemovalStates.COMPLETED);
        expect(h.events.errors).toEqual([]);

        const summary = h.completedSummary();
        expect(summary.removed.some(entry => entry.includes("winboat_data"))).toBe(true);
        expect(summary.warnings).toEqual([]);

        await h.cleanup();
    });

    it("legacy named volume with PODMAN runtime: exec NOT called, warning present, no error", async () => {
        const h = await createHarness({
            storageVolume: "data:/storage",
            runtime: ContainerRuntimes.PODMAN,
            exec: async () => {
                throw new Error("exec must never be called for a legacy volume under Podman");
            },
        });

        await h.manager.run();

        expect(h.calls.exec).toEqual([]); // never shell out to `docker` under Podman
        expect(h.events.errors).toEqual([]);
        expect(h.manager.state).toBe(RemovalStates.COMPLETED);

        const summary = h.completedSummary();
        expect(summary.warnings).toHaveLength(1);
        expect(summary.warnings[0]).toContain("winboat_data");
        expect(summary.removed.some(entry => entry.includes("winboat_data"))).toBe(false);
        expect(h.events.logs.some(line => line.includes("winboat_data"))).toBe(true);

        await h.cleanup();
    });

    it("bind folder missing: warning, not error", async () => {
        const h = await createHarness(); // storage folder does not exist on disk

        await h.manager.run();

        expect(h.events.errors).toEqual([]);
        expect(h.manager.state).toBe(RemovalStates.COMPLETED);

        const summary = h.completedSummary();
        expect(summary.warnings).toHaveLength(1);
        expect(summary.warnings[0]).toContain(h.dirs.storageDir);
        expect(summary.removed.some(entry => entry.includes(h.dirs.storageDir))).toBe(false);

        await h.cleanup();
    });

    it("precheck failure: missing compose file stops the flow with an actionable error", async () => {
        const h = await createHarness({
            storageVolume: "data:/storage",
            composeFileExists: false,
        });

        await h.manager.run();

        expect(h.events.errors).toHaveLength(1);
        expect(h.events.errors[0].state).toBe(RemovalStates.PRECHECK);
        expect(h.events.errors[0].error.message).toContain(h.composeFilePath);
        expect(h.calls.stop).toBe(0);
        expect(h.manager.state).toBe(RemovalStates.REMOVAL_ERROR);
        expect(h.events.completed).toHaveLength(0);

        await h.cleanup();
    });

    it("empty compose file: PRECHECK fails with the actionable message and nothing is removed", async () => {
        const h = await createHarness({
            composeFileContent: "   \n", // whitespace only: YAML.parse yields null
            createStorageFolder: true,
            createWinboatMarker: true,
        });

        await h.manager.run();

        expect(h.events.errors).toHaveLength(1);
        expect(h.events.errors[0].state).toBe(RemovalStates.PRECHECK);
        expect(h.events.errors[0].error.message).toContain("empty or malformed");
        expect(h.events.errors[0].error.message).toContain(h.composeFilePath);
        expect(h.calls.stop).toBe(0);
        expect(h.manager.state).toBe(RemovalStates.REMOVAL_ERROR);
        expect(h.events.completed).toHaveLength(0);

        // No storage or WinBoat dir deletion happened
        expect(fs.existsSync(h.dirs.storageDir)).toBe(true);
        expect(fs.existsSync(path.join(h.dirs.winboatDir, "config.json"))).toBe(true);

        await h.cleanup();
    });

    it("run with a non-executable fromStep throws before executing any step", async () => {
        const h = await createHarness({ createStorageFolder: true });

        let thrown: unknown = null;
        try {
            await h.manager.run({ fromStep: RemovalStates.COMPLETED });
        } catch (e) {
            thrown = e;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(h.events.steps).toEqual([]);
        expect(h.calls.stop).toBe(0);
        expect(h.manager.state).toBe(RemovalStates.PRECHECK);

        await h.cleanup();
    });
});

describe("removal metadata", () => {
    it("step order contains exactly the 5 executable steps in order", () => {
        expect(REMOVAL_STEP_ORDER).toEqual([
            RemovalStates.PRECHECK,
            RemovalStates.STOPPING_CONTAINER,
            RemovalStates.REMOVING_CONTAINER,
            RemovalStates.REMOVING_STORAGE,
            RemovalStates.REMOVING_WINBOAT_DIR,
        ]);
    });

    it("every removal state has a human-readable description", () => {
        for (const state of Object.values(RemovalStates)) {
            expect(typeof REMOVAL_STEP_DESCRIPTIONS[state]).toBe("string");
            expect(REMOVAL_STEP_DESCRIPTIONS[state].length).toBeGreaterThan(0);
        }
    });

    it("removalProgress returns cumulative percents within 0-100, non-decreasing across steps", () => {
        expect(REMOVAL_STEP_WEIGHTS).toHaveLength(REMOVAL_STEP_ORDER.length);
        expect(REMOVAL_STEP_WEIGHTS.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1);

        const values = REMOVAL_STEP_ORDER.map(state => removalProgress(state));
        for (const value of values) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
        }
        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
        }

        expect(removalProgress(RemovalStates.PRECHECK)).toBe(0);
        expect(removalProgress(RemovalStates.COMPLETED)).toBe(100);
    });
});

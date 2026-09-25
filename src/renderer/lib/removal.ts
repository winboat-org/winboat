import { createNanoEvents, type Emitter } from "nanoevents";
import YAML from "yaml";
import type { ComposeConfig } from "../../types";
import { createLogger } from "../utils/log";
import { ContainerRuntimes } from "./containers/common";

const fs: typeof import("fs") = require("node:fs");
const fsp: typeof import("fs/promises") = require("node:fs/promises");
const path: typeof import("path") = require("node:path");
const { promisify }: typeof import("util") = require("node:util");
const { exec }: typeof import("child_process") = require("node:child_process");

const execAsync = promisify(exec);

/**
 * Name of the legacy Docker named volume created by very old WinBoat installs
 * (compose project "winboat" + volume "data").
 */
const LEGACY_VOLUME_NAME = "winboat_data";

export enum RemovalStates {
    PRECHECK = "Pre-flight checks",
    STOPPING_CONTAINER = "Stopping container",
    REMOVING_CONTAINER = "Removing container",
    REMOVING_STORAGE = "Removing VM disk",
    REMOVING_WINBOAT_DIR = "Removing WinBoat data",
    COMPLETED = "Completed",
    REMOVAL_ERROR = "Removal error",
}

/** The 5 executable removal steps, in the order they are executed */
export const REMOVAL_STEP_ORDER: RemovalStates[] = [
    RemovalStates.PRECHECK,
    RemovalStates.STOPPING_CONTAINER,
    RemovalStates.REMOVING_CONTAINER,
    RemovalStates.REMOVING_STORAGE,
    RemovalStates.REMOVING_WINBOAT_DIR,
];

/** One human-readable sentence per step, explaining what happens and why */
export const REMOVAL_STEP_DESCRIPTIONS: Record<RemovalStates, string> = {
    [RemovalStates.PRECHECK]:
        "Verifying that the compose file, the VM storage and the log location are reachable before anything gets removed.",
    [RemovalStates.STOPPING_CONTAINER]:
        "Stopping the container to shut Windows down safely before its disk is removed.",
    [RemovalStates.REMOVING_CONTAINER]:
        "Removing the stopped Windows container so it no longer shows up in Docker or Podman.",
    [RemovalStates.REMOVING_STORAGE]:
        "Deleting the VM disk storage, which permanently erases Windows and everything inside the VM.",
    [RemovalStates.REMOVING_WINBOAT_DIR]:
        "Deleting the WinBoat data directory, which holds the last remaining configuration and logs.",
    [RemovalStates.COMPLETED]: "WinBoat has been fully removed from this system.",
    [RemovalStates.REMOVAL_ERROR]:
        "The removal stopped because of an error; nothing else was removed and no data was touched further.",
};

/** Relative cost of each step in {@link REMOVAL_STEP_ORDER}, summing up to 1 */
export const REMOVAL_STEP_WEIGHTS: number[] = [0.05, 0.15, 0.15, 0.6, 0.05];

/**
 * Returns the cumulative removal progress (0-100) for the given state, i.e. how much
 * of the removal has been completed by the time the flow reaches that state.
 * `COMPLETED` resolves to 100, `REMOVAL_ERROR` to 0 (the error view replaces the bar).
 */
export function removalProgress(state: RemovalStates): number {
    const stepIndex = REMOVAL_STEP_ORDER.indexOf(state);

    if (stepIndex === -1) {
        return state === RemovalStates.COMPLETED ? 100 : 0;
    }

    const finishedWeight = REMOVAL_STEP_WEIGHTS.slice(0, stepIndex).reduce((sum, weight) => sum + weight, 0);
    return Math.round(finishedWeight * 100);
}

/**
 * Everything the removal flow needs from the outside world. Injected so it can be
 * mocked in tests; `Winboat.createRemovalManager()` supplies the real ones.
 */
export interface RemovalDeps {
    stopContainer(): Promise<void>;
    removeContainer(): Promise<void>;
    composeFilePath: string;
    runtime: ContainerRuntimes;
    winboatDir: string;
    /** Shells out to the container engine; injectable for tests. Defaults to promisified `child_process.exec`. */
    exec?(cmd: string): Promise<{ stdout: string; stderr: string }>;
}

/** What was actually removed and what was skipped during the removal flow */
export interface RemovalSummary {
    removed: string[];
    warnings: string[];
}

interface RemovalEvents {
    /** `index` is the zero-based position in REMOVAL_STEP_ORDER; render as `index + 1` of `total` */
    stepChanged: (state: RemovalStates, index: number, total: number) => void;
    log: (line: string) => void;
    error: (state: RemovalStates, error: Error) => void;
    completed: (summary: RemovalSummary) => void;
}

/**
 * Runs the "Reset Winboat & Remove VM" flow as 5 observable steps, reporting
 * progress, live log lines, errors (with retry via {@link RemovalManager.run}) and a
 * final summary. Replaces the old `Winboat.resetWinboat()`, which deleted everything
 * synchronously and left the UI frozen with only a spinner for feedback.
 */
export class RemovalManager {
    deps: RemovalDeps;
    emitter: Emitter<RemovalEvents>;
    state: RemovalStates = RemovalStates.PRECHECK;
    readonly #logger;
    readonly #exec: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
    /** Accumulates across runs so retries still report what earlier attempts removed */
    readonly #summary: RemovalSummary = { removed: [], warnings: [] };
    /** True while {@link RemovalManager.run} is in flight; guards against concurrent runs */
    #running = false;

    constructor(deps: RemovalDeps) {
        this.deps = deps;
        this.emitter = createNanoEvents<RemovalEvents>();
        this.#logger = createLogger(path.join(deps.winboatDir, "removal.log"));
        this.#exec = deps.exec ?? execAsync;
    }

    /** True while a run is in flight. Retries (`run({ fromStep })`) count as part of the same run. */
    get running(): boolean {
        return this.#running;
    }

    /**
     * Runs the removal flow, starting at `opts.fromStep` if given (retry semantics),
     * otherwise from the beginning. Step failures are reported through the `error`
     * event and stop the flow; this method never throws for them.
     *
     * The only exceptions are programmer errors: calling this while another run is
     * still in flight (check {@link RemovalManager.running} first), or passing an
     * invalid `opts.fromStep`. A run keeps executing headless if the UI navigates
     * away mid-flight; reattach to the same manager instead of starting a second one.
     */
    async run(opts?: { fromStep?: RemovalStates }): Promise<void> {
        if (this.#running) {
            throw new Error("A removal run is already in progress");
        }

        this.#running = true;

        try {
            await this.#runSteps(opts);
        } finally {
            this.#running = false;
        }
    }

    async #runSteps(opts?: { fromStep?: RemovalStates }): Promise<void> {
        let startIndex = 0;

        if (opts?.fromStep !== undefined) {
            startIndex = REMOVAL_STEP_ORDER.indexOf(opts.fromStep);
            if (startIndex === -1) {
                throw new Error(
                    `"${opts.fromStep}" is not an executable removal step. Valid steps: ${REMOVAL_STEP_ORDER.join(", ")}`,
                );
            }
        }

        for (let index = startIndex; index < REMOVAL_STEP_ORDER.length; index++) {
            const step = REMOVAL_STEP_ORDER[index];

            this.#changeStep(step, index);

            try {
                switch (step) {
                    case RemovalStates.PRECHECK:
                        await this.#precheck();
                        break;
                    case RemovalStates.STOPPING_CONTAINER:
                        await this.#stopContainer();
                        break;
                    case RemovalStates.REMOVING_CONTAINER:
                        await this.#removeContainer();
                        break;
                    case RemovalStates.REMOVING_STORAGE:
                        await this.#removeStorage();
                        break;
                    case RemovalStates.REMOVING_WINBOAT_DIR:
                        await this.#removeWinboatDir();
                        break;
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                this.#handleStepError(step, error);
                return;
            }
        }

        this.state = RemovalStates.COMPLETED;
        this.#log(`Removed: ${this.#summary.removed.join(", ")}`);

        if (this.#summary.warnings.length > 0) {
            this.#log(`Skipped: ${this.#summary.warnings.join("; ")}`, "warn");
        }

        this.#log("Removal completed successfully. So long and thanks for all the fish!");
        this.emitter.emit("completed", this.#summary);
    }

    #changeStep(step: RemovalStates, index: number) {
        this.state = step;
        this.emitter.emit("stepChanged", step, index, REMOVAL_STEP_ORDER.length);
        this.#log(`Step ${index + 1}/${REMOVAL_STEP_ORDER.length}: ${step} - ${REMOVAL_STEP_DESCRIPTIONS[step]}`);
    }

    #handleStepError(step: RemovalStates, error: Error) {
        this.state = RemovalStates.REMOVAL_ERROR;
        this.#log(`Removal failed at step '${step}': ${error.message}`, "warn");
        this.#log(`Error details: ${error.stack ?? error.message}`);
        this.emitter.emit("error", step, error);
    }

    /** Logs to both the removal.log file and the live UI panel. File logging must never break the flow. */
    #log(line: string, level: "info" | "warn" = "info") {
        try {
            this.#logger[level](line);
        } catch {
            // The log dir may already be gone (last step) or be unwritable; the UI still gets the line.
        }

        this.emitter.emit("log", line);
    }

    #addWarning(message: string) {
        this.#summary.warnings.push(message);
        this.#log(`Warning: ${message}`, "warn");
    }

    #markRemoved(resource: string) {
        this.#summary.removed.push(resource);
        this.#log(`Removed ${resource}`);
    }

    #readCompose(): ComposeConfig {
        if (!fs.existsSync(this.deps.composeFilePath)) {
            throw new Error(
                `Compose file not found at '${this.deps.composeFilePath}'. ` +
                    "WinBoat cannot determine what to remove without it. Restore the file or remove the container manually.",
            );
        }

        let compose: unknown;

        try {
            const composeFile = fs.readFileSync(this.deps.composeFilePath, "utf-8");
            compose = YAML.parse(composeFile);
        } catch (e) {
            throw new Error(
                `Could not parse the compose file at '${this.deps.composeFilePath}': ${e}. ` +
                    "Fix or remove the file before retrying.",
            );
        }

        // YAML.parse yields null for a blank or truncated file, which would otherwise
        // blow up later with a raw TypeError instead of an actionable message
        if (!compose || typeof compose !== "object") {
            throw new Error(
                `The compose file at '${this.deps.composeFilePath}' is empty or malformed. ` +
                    "WinBoat cannot determine what to remove without it. Fix or remove the file before retrying.",
            );
        }

        return compose as ComposeConfig;
    }

    #findStorageEntry(compose: ComposeConfig): string | undefined {
        return (compose.services?.windows?.volumes ?? []).find(volume => volume.includes("/storage"));
    }

    async #precheck() {
        this.#log("Running pre-flight checks...");

        const compose = this.#readCompose();

        if (!this.#findStorageEntry(compose)) {
            throw new Error(
                `No '/storage' volume was found in '${this.deps.composeFilePath}'. ` +
                    "WinBoat cannot tell which VM disk to remove. Check the compose file before retrying.",
            );
        }

        const logFilePath = path.join(this.deps.winboatDir, "removal.log");

        try {
            await fsp.appendFile(logFilePath, "");
        } catch {
            throw new Error(
                `Cannot write to the removal log at '${logFilePath}'. ` +
                    "Check the permissions of the WinBoat data directory and that the disk is not full, then retry.",
            );
        }

        this.#log("Pre-flight checks passed");
    }

    async #stopContainer() {
        this.#log("Stopping the Windows container...");
        await this.deps.stopContainer();
        this.#log("Stopped the Windows container");
    }

    async #removeContainer() {
        this.#log("Removing the Windows container...");
        await this.deps.removeContainer();
        this.#markRemoved("the Windows container");
    }

    async #removeStorage() {
        const compose = this.#readCompose();
        const storage = this.#findStorageEntry(compose);

        if (!storage) {
            // Pre-flight passed with it earlier, so the compose file changed mid-flight
            throw new Error(
                `No '/storage' volume was found in '${this.deps.composeFilePath}'. Cannot remove the VM disk.`,
            );
        }

        if (storage.startsWith("data:")) {
            // Legacy install: the VM disk lives in a Docker named volume, not in a bind folder
            if (this.deps.runtime === ContainerRuntimes.PODMAN) {
                // Bug fix: the old code shelled out to `docker` regardless of the runtime,
                // which always fails under Podman. Skip and tell the user how to do it manually.
                this.#addWarning(
                    `Legacy Docker named volume '${LEGACY_VOLUME_NAME}' cannot be removed automatically with the ` +
                        `Podman runtime. Remove it manually with: podman volume rm ${LEGACY_VOLUME_NAME}`,
                );
                return;
            }

            this.#log(`Removing legacy Docker named volume '${LEGACY_VOLUME_NAME}'...`);
            await this.#exec(`docker volume rm ${LEGACY_VOLUME_NAME}`);
            this.#markRemoved(`Docker volume '${LEGACY_VOLUME_NAME}'`);
            return;
        }

        const storageFolder = storage.split(":").at(0) ?? null;

        if (!storageFolder) {
            throw new Error(`Volume entry '${storage}' does not specify a host path. Cannot remove the VM disk.`);
        }

        if (!fs.existsSync(storageFolder)) {
            this.#addWarning(`Storage folder '${storageFolder}' does not exist, skipping removal.`);
            return;
        }

        this.#log(`Removing VM disk storage at '${storageFolder}'...`);
        await fsp.rm(storageFolder, { recursive: true, force: true });
        this.#markRemoved(`VM disk storage at '${storageFolder}'`);
    }

    async #removeWinboatDir() {
        if (!fs.existsSync(this.deps.winboatDir)) {
            this.#addWarning(`WinBoat data directory '${this.deps.winboatDir}' does not exist, skipping removal.`);
            return;
        }

        this.#log(`Removing WinBoat data directory '${this.deps.winboatDir}'...`);
        await fsp.rm(this.deps.winboatDir, { recursive: true, force: true });
        this.#markRemoved(`WinBoat data directory '${this.deps.winboatDir}'`);
        // Logging this line may recreate the dir for removal.log (see createLogger) - that is fine.
    }
}

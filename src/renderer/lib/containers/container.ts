import { ComposeConfig } from "../../../types";
import { CONTAINER_LOG_FILE } from "../constants";
import { createLogger } from "../../utils/log";
import { execFileAsync } from "../exec-helper";

const path: typeof import("node:path") = require("node:path");

export const containerLogger = createLogger(CONTAINER_LOG_FILE);

export function redactComposeSecrets(content: string): string {
    return content.replace(/^(\s*PASSWORD:\s*).*$/gim, "$1<redacted>");
}

export type ComposeDirection = "up" | "down";
export type ComposeArguments = "--no-start";
export type ContainerAction = "start" | "stop" | "pause" | "unpause" | "restart";

export abstract class ContainerManager {
    abstract readonly defaultCompose: ComposeConfig;
    abstract readonly composeFilePath: string;
    abstract readonly executableAlias: string;

    abstract writeCompose(compose: ComposeConfig): void;
    abstract compose(direction: ComposeDirection, extraArgs?: ComposeArguments[]): Promise<void>;
    abstract container(action: ContainerAction): Promise<void>;
    abstract remove(): Promise<void>;
    abstract getStatus(): Promise<ContainerStatus>;
    abstract exists(): Promise<boolean>;

    abstract get containerName(): string;

    async getExitError(): Promise<string | null> {
        try {
            const { stdout } = await execFileAsync(this.executableAlias, [
                "inspect",
                "--format={{json .State}}",
                this.containerName,
            ]);
            const state = JSON.parse(stdout);
            // A clean shutdown from Windows or the host runtime is not a failure.
            if (!["exited", "stopped", "dead"].includes(state.Status)) return null;
            if (state.OOMKilled) return "The Windows container ran out of memory.";
            if (state.Error) return String(state.Error);
            if (state.Dead || state.Status === "dead") return "The Windows container is in a dead state.";
            if (typeof state.ExitCode === "number" && state.ExitCode !== 0)
                return `The Windows container exited with code ${state.ExitCode}.`;
        } catch (error) {
            containerLogger.error(`Could not inspect the Windows container's exit result: ${error}`);
        }
        return null;
    }

    // static "abstract" function
    static async _getSpecs(): Promise<any> {
        throw new Error("Can't get specs of abstract class ContainerManager");
    }
}

export enum ContainerStatus {
    CREATED = "Created", // unused
    RUNNING = "Running",
    PAUSED = "Paused",
    EXITED = "Exited",
    UNKNOWN = "Unknown",
    ERROR = "ERROR",
}

// Errors which usually indicate that the container is in a stale/broken state,
// e.g. because it references a passed-through USB device that is no longer
// present on the host. In these cases the container can't be started again and
// needs to be recreated from the compose file
const STALE_CONTAINER_ERROR_PATTERNS = [
    /cannot stat `[^`]*`:?\s*no such file or directory/i,
    /failed to fulfil mount request:.*\bopen\b.*\bno such file or directory\b/i,
    /oci runtime attempted to invoke a command that was not found/i,
    /no such device or address/i,
];

function getErrorText(error: unknown): string {
    if (!error) return "";
    if (typeof error === "string") return error;

    if (typeof error === "object") {
        const anyError = error as { message?: string; stderr?: string; stdout?: string };
        return [anyError.message, anyError.stderr, anyError.stdout].filter(Boolean).join("\n");
    }

    return String(error);
}

/**
 * Determines whether an error thrown while starting/interacting with a container
 * indicates that the container itself is stale/malfunctioning (e.g. due to
 * an USB passthrough device that no longer exists on the host).
 */
export function isStaleContainerError(error: unknown): boolean {
    const text = getErrorText(error);
    return STALE_CONTAINER_ERROR_PATTERNS.some(pattern => pattern.test(text));
}

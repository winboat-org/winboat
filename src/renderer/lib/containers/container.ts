import { ComposeConfig } from "../../../types";
import { CONTAINER_LOG_FILE } from "../constants";
import { createLogger } from "../../utils/log";

const path: typeof import("node:path") = require("node:path");

export const containerLogger = createLogger(CONTAINER_LOG_FILE);

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
// present on the host, or a network that has since been pruned. In these cases
// the container can't be started again and needs to be recreated from the
// compose file. Patterns must stay specific: Docker reuses its "failed to set up
// container networking" prefix for port binding failures, which are not stale.
const STALE_CONTAINER_ERROR_PATTERNS = [
    /cannot stat `[^`]*`:?\s*no such file or directory/i,
    /error gathering device information while adding custom device/i,
    /oci runtime attempted to invoke a command that was not found/i,
    /no such device or address/i,
    /network [^\s"']+ not found/i,
    /unable to find network/i,
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

/**
 * Condenses a raw container-runtime error into a single line for the UI, by
 * preferring the daemon's own message over the command wrapper around it.
 */
export function summarizeContainerError(error: unknown): string {
    const lines = getErrorText(error)
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

    if (!lines.length) return "Unknown error";

    const daemonLine = lines.find(line => /error response from daemon:/i.test(line));
    if (daemonLine) {
        return daemonLine.replace(/^error response from daemon:\s*/i, "");
    }

    const meaningful = lines.find(line => !/^command failed:/i.test(line));
    return meaningful ?? lines[0];
}

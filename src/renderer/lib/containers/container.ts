import { ComposeConfig } from "../../../types";
import { WINBOAT_DIR } from "../constants";
import { createLogger } from "../../utils/log";
import { ComposePortEntry } from "../../utils/port";

const path: typeof import("node:path") = require("node:path");

export const containerLogger = createLogger(path.join(WINBOAT_DIR, "container.log"));

export function redactComposeSecrets(content: string): string {
    return content.replace(/^(\s*PASSWORD:\s*).*$/gim, "$1<redacted>");
}

export type ComposeDirection = "up" | "down";
export type ComposeArguments = "--no-start";
export type ContainerAction = "start" | "stop" | "pause" | "unpause";

export abstract class ContainerManager {
    abstract readonly defaultCompose: ComposeConfig;
    abstract readonly composeFilePath: string;
    abstract readonly executableAlias: string;

    abstract cachedPortMappings: ComposePortEntry[] | null;

    abstract writeCompose(compose: ComposeConfig): void;
    abstract compose(direction: ComposeDirection, extraArgs?: ComposeArguments[]): Promise<void>;
    abstract container(action: ContainerAction): Promise<void>;
    abstract port(): Promise<ComposePortEntry[]>;
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
}

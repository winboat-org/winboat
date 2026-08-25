import { ComposeConfig } from "../../../types";
import { PODMAN_DEFAULT_COMPOSE } from "../../data/podman";
import { WINBOAT_DIR } from "../constants";
import {
    ComposeArguments,
    ComposeDirection,
    ContainerAction,
    containerLogger,
    ContainerManager,
    ContainerStatus,
    redactComposeSecrets,
} from "./container";
import YAML from "yaml";
import { capitalizeFirstLetter } from "../../utils/capitalize";
import { ComposePortEntry } from "../../utils/port";
import { concatEnv, execFileAsync, stringifyExecFile } from "../exec-helper";

const path: typeof import("node:path") = require("node:path");
const fs: typeof import("node:fs") = require("node:fs");
const process: typeof import("process") = require("node:process");

export type PodmanSpecs = {
    podmanInstalled: boolean;
    podmanComposeInstalled: boolean;
};

export enum PodmanAPIStatus {
    AVAILABLE = "Available",
    UNAVAILABLE = "Unavailable",
}

type PodmanInfo = {
    host: {
        remoteSocket: {
            exists: boolean;
            path: string;
        };
        [Key: string]: any;
    };
    plugins: object;
    registries: {
        search: string[];
    };
    store: object;
    version: object;
};

const COMPOSE_ENV_VARS = { PODMAN_COMPOSE_PROVIDER: "podman-compose", PODMAN_COMPOSE_WARNING_LOGS: "false" };

export class PodmanContainer extends ContainerManager {
    defaultCompose = PODMAN_DEFAULT_COMPOSE;
    composeFilePath = path.join(WINBOAT_DIR, "podman-compose.yml");
    executableAlias = "podman";

    cachedPortMappings: ComposePortEntry[] | null = null;

    constructor() {
        super();
    }

    writeCompose(compose: ComposeConfig): void {
        const composeContent = YAML.stringify(compose, { nullStr: "" });
        fs.writeFileSync(this.composeFilePath, composeContent, { encoding: "utf-8" });

        containerLogger.info(`Wrote to compose file at: ${this.composeFilePath}`);
        containerLogger.info(`Compose file content:\n${redactComposeSecrets(composeContent)}`);
    }

    async compose(direction: ComposeDirection, extraArgs: ComposeArguments[] = []): Promise<void> {
        const args = ["compose", "-f", this.composeFilePath, direction, ...extraArgs];

        if (direction === "up") {
            // Run compose in detached mode if we are running compose up
            args.push("-d");
        }

        try {
            const { stderr } = await execFileAsync(this.executableAlias, args, {
                env: concatEnv(process.env as { [key: string]: string }, COMPOSE_ENV_VARS),
            });
            if (stderr) {
                containerLogger.error(stderr);
            }
        } catch (e) {
            containerLogger.error(`Failed to run compose command '${stringifyExecFile(this.executableAlias, args)}'`);
            containerLogger.error(e);
            throw e;
        }
    }

    async container(action: ContainerAction): Promise<void> {
        const args = ["container", action, this.containerName];
        try {
            const { stdout } = await execFileAsync(this.executableAlias, args);
            containerLogger.info(`Container action '${action}' response: '${stdout}'`);
        } catch (e) {
            containerLogger.error(`Failed to run container action '${stringifyExecFile(this.executableAlias, args)}'`);
            containerLogger.error(e);
            throw e;
        }
    }

    async port(): Promise<ComposePortEntry[]> {
        const args = ["port", this.containerName];
        const ret = [];

        try {
            const { stdout } = await execFileAsync(this.executableAlias, args);

            for (const line of stdout.trim().split("\n")) {
                const parts = line.split("->").map(part => part.trim());
                const hostPart = parts[1];
                const containerPart = parts[0];

                ret.push(new ComposePortEntry(`${hostPart}:${containerPart}`));
            }
        } catch (e) {
            containerLogger.error(`Failed to run container action '${stringifyExecFile(this.executableAlias, args)}'`);
            containerLogger.error(e);
            throw e;
        }

        containerLogger.info("Podman container active port mappings: ", JSON.stringify(ret));
        this.cachedPortMappings = ret;
        return ret;
    }

    async remove(): Promise<void> {
        const args = ["rm", this.containerName];

        try {
            await execFileAsync(this.executableAlias, args);
        } catch (e) {
            containerLogger.error(`Failed to remove container '${this.containerName}'`);
            containerLogger.error(e);
        }
    }

    async getStatus(): Promise<ContainerStatus> {
        const statusMap = {
            created: ContainerStatus.CREATED,
            restarting: ContainerStatus.UNKNOWN,
            initialized: ContainerStatus.UNKNOWN,
            removing: ContainerStatus.UNKNOWN,
            stopping: ContainerStatus.EXITED,
            stopped: ContainerStatus.EXITED,
            running: ContainerStatus.RUNNING,
            paused: ContainerStatus.PAUSED,
            exited: ContainerStatus.EXITED,
            dead: ContainerStatus.UNKNOWN,
        } as const;
        const args = ["inspect", "--format={{.State.Status}}", this.containerName];

        try {
            const { stdout } = await execFileAsync(this.executableAlias, args);
            const status = stdout.trim() as keyof typeof statusMap;
            return statusMap[status];
        } catch (e) {
            containerLogger.error(`Failed to get status of podman container ${e}'`);
            return ContainerStatus.UNKNOWN;
        }
    }

    async exists(): Promise<boolean> {
        const args = ["ps", "-a", "--filter", `name=${this.containerName}`, "--format", "{{.Names}}"];
        try {
            const { stdout: exists } = await execFileAsync(this.executableAlias, args);
            return exists.includes(this.containerName);
        } catch (e) {
            containerLogger.error(
                `Failed to get container status, is ${capitalizeFirstLetter(this.executableAlias)} installed?`,
            );
            containerLogger.error(e);
            return false;
        }
    }

    get containerName(): string {
        return this.defaultCompose.services.windows.container_name; // TODO: investigate whether we should use the compose on disk
    }

    static override async _getSpecs(): Promise<PodmanSpecs> {
        let specs: PodmanSpecs = {
            podmanInstalled: false,
            podmanComposeInstalled: false,
        };

        try {
            const { stdout: podmanOutput } = await execFileAsync("podman", ["--version"]);
            specs.podmanInstalled = !!podmanOutput;
        } catch (e) {
            containerLogger.error("Error checking podman version");
            containerLogger.error(e);
        }

        try {
            const { stdout: podmanComposeOutput } = await execFileAsync("podman", ["compose", "--version"], {
                env: concatEnv(process.env as { [key: string]: string }, COMPOSE_ENV_VARS),
            });
            specs.podmanComposeInstalled = !!podmanComposeOutput;
        } catch (e) {
            containerLogger.error("Error checking podman compose version");
            containerLogger.error(e);
        }

        return specs;
    }
}

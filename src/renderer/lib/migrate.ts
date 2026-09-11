import { createLogger } from "../utils/log";
import { WINBOAT_DIR } from "./constants";
import { hasFixedHostPorts, withFixedHostPorts } from "../utils/composePorts";
import { WinboatConfig } from "./config";
import { createContainer } from "./containers/common";
import { Winboat } from "./winboat";

const path: typeof import("path") = require("path");
const fs: typeof import("fs") = require("fs");
const logger = createLogger(path.join(WINBOAT_DIR, "migrations.log"));

type Migration = {
    name: string;
    /** Whether the migration needs to run against the current installation */
    isNeeded: () => boolean | Promise<boolean>;
    migrate: () => Promise<void>;
};

/**
 * Migrations run in order on every app start, each gated by its own `isNeeded` check.
 */
const migrations: Migration[] = [
    {
        // Installations created before the switch to fixed host ports bound their
        // services across ranges (47270-47279, 47280-47289, ...) and the app found
        // the real port by querying the container at runtime. That lookup is gone,
        // so the host now talks to fixed ports the old container never published
        // and the Guest Server API can never come online. Rewrite the block and
        // redeploy so the container actually publishes what the app connects to.
        name: "compose-fixed-host-ports",
        isNeeded: () => {
            const wbConfig = WinboatConfig.getInstance();
            const containerMgr = createContainer(wbConfig.config.containerRuntime);

            // Nothing to migrate if this install has no compose file to rewrite
            if (!fs.existsSync(containerMgr.composeFilePath)) return false;

            const compose = Winboat.readCompose(containerMgr.composeFilePath);

            return !hasFixedHostPorts(compose.services.windows.ports ?? []);
        },
        migrate: async () => {
            const wbConfig = WinboatConfig.getInstance();
            const containerMgr = createContainer(wbConfig.config.containerRuntime);
            const compose = Winboat.readCompose(containerMgr.composeFilePath);
            const existing = compose.services.windows.ports ?? [];

            compose.services.windows.ports = withFixedHostPorts(existing);

            logger.info(`[compose-fixed-host-ports]: Replacing port mappings ${JSON.stringify(existing)}`);
            logger.info(`[compose-fixed-host-ports]: New port mappings ${JSON.stringify(compose.services.windows.ports)}`);

            // Backs up the old compose and redeploys the container with the new one.
            await Winboat.getInstance().replaceCompose(compose);
        },
    },
];

/**
 * This function performs the necessary automatic migrations
 * when updating to newer versions of WinBoat
 */
export async function performAutoMigrations(): Promise<void> {
    logger.info("[performAutoMigrations]: Starting automatic migrations");

    for (const migration of migrations) {
        try {
            if (!(await migration.isNeeded())) continue;

            logger.info(`[performAutoMigrations]: Running migration '${migration.name}'`);
            await migration.migrate();
        } catch (e: any) {
            logger.error(`[performAutoMigrations]: Migration '${migration.name}' failed`);
            logger.error(e.message ?? e);
        }
    }

    logger.info("[performAutoMigrations]: Finished automatic migrations");
}

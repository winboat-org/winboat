import { assert } from "@vueuse/core";
import { ref, type Ref } from "vue";
import YAML from "yaml";
import type { ComposeConfig, CustomAppCallbacks, GuestServerVersion, Metrics, WinApp } from "../../types";
import { AppIcons } from "../data/appicons";
import { InternalApps } from "../data/internalapps";
import { getFreeRDP } from "../utils/getFreeRDP";
import { guestAuthHeaders, guestServerUpdateZipPath } from "../utils/guestServer";
import { setIntervalImmediately } from "../utils/interval";
import { createLogger } from "../utils/log";
import { openLink } from "../utils/openLink";
import { MultiMonitorMode, WinboatConfig } from "./config";
import { HOST_QMP_PORT, HOST_RDP_PORT, NOVNC_URL, WINBOAT_API_URL, WINBOAT_DIR, WINBOAT_UPDATE_URL } from "./constants";
import { ContainerRuntimes, createContainer } from "./containers/common";
import { ContainerManager, ContainerStatus, isStaleContainerError } from "./containers/container";
import { ExecFileAsyncError } from "./exec-helper";
import { QMPManager } from "./qmp";

const nodeFetch: typeof import("node-fetch").default = require("node-fetch");
const fs: typeof import("fs") = require("node:fs");
const path: typeof import("path") = require("node:path");
const { promisify }: typeof import("util") = require("node:util");
const { exec }: typeof import("child_process") = require("node:child_process");

const execAsync = promisify(exec);
const USAGE_PATH = path.join(WINBOAT_DIR, "appUsage.json");
export const logger = createLogger(path.join(WINBOAT_DIR, "winboat.log"));

enum CustomAppCommands {
    NOVNC_COMMAND = "NOVNC_COMMAND",
}

const presetApps: WinApp[] = [
    {
        Name: "⚙️ Windows Desktop",
        Icon: AppIcons[InternalApps.WINDOWS_DESKTOP],
        Source: "internal",
        Path: InternalApps.WINDOWS_DESKTOP,
        Args: "",
        Usage: 0,
    },
    {
        Name: "⚙️ Windows Explorer",
        Icon: AppIcons[InternalApps.WINDOWS_EXPLORER],
        Source: "internal",
        Path: "%windir%\\explorer.exe",
        Args: "",
        Usage: 0,
    },
    {
        Name: "⚙️ Windows Settings",
        Icon: AppIcons[InternalApps.WINDOWS_SETTINGS],
        Source: "internal",
        Path: "%windir%\\explorer.exe",
        Args: "ms-settings:",
        Usage: 0,
    },
    {
        Name: "🖥️ Browser Display",
        Icon: AppIcons[InternalApps.NOVNC_BROWSER],
        Source: "internal",
        Path: CustomAppCommands.NOVNC_COMMAND,
        Args: "",
        Usage: 0,
    },
];

/**
 * The stock RDP args that apply to all app launches by default
 */
const stockArgs = [
    "/cert:ignore",
    "+clipboard",
    "/sound:sys:pulse",
    "/microphone:sys:pulse",
    "/floatbar",
    "/compression",
    "/sec:tls",
];

/**
 * Returns second/original param if first is undefined or null, else first/test param
 */
const useOriginalIfUndefinedOrNull = (test: string | undefined, original: string) => {
    return test ?? original;
};

/**
 * For specifying custom behavior when launching an app (e.g. novnc)
 * Maps a {@link WinApp.Path} to a callback, which is called in {@link Winboat.launchApp} if specified
 */
const customAppCallbacks: CustomAppCallbacks = {
    [CustomAppCommands.NOVNC_COMMAND]: () => {
        openLink(NOVNC_URL);
    },
};

const QMP_WAIT_MS = 2000;
const FETCH_TIMEOUT = 1000;
const GUEST_ONLINE_TIMEOUT_MS = 60_000;

class AppManager {
    appCache: WinApp[] = [];
    appUsageCache: { [key: string]: number } = {};
    readonly #wbConfig: WinboatConfig | null = null;

    constructor() {
        if (!fs.existsSync(USAGE_PATH)) {
            fs.writeFileSync(USAGE_PATH, "{}");
        }

        this.#wbConfig = WinboatConfig.getInstance();
    }

    async updateAppCache(options: { forceRead?: boolean } = {}) {
        const res = await nodeFetch(`${WINBOAT_API_URL}/apps`, { headers: guestAuthHeaders() });
        const newApps = (await res.json()) as WinApp[];
        newApps.push(...presetApps, ...this.#wbConfig!.config.customApps);

        if (this.appCache.length == newApps.length && !options.forceRead) return;

        for (const appIdx in newApps) {
            newApps[appIdx].Usage = this.appCache.find(app => app.Name == newApps[appIdx].Name)?.Usage || 0;
            this.appUsageCache[newApps[appIdx].Name] = newApps[appIdx].Usage;
        }

        this.appCache = newApps;
    }

    async getApps(): Promise<WinApp[]> {
        if (this.appCache.length > 0) {
            return this.appCache;
        }

        // Get the usage object that's on the disk
        const fsUsage = Object.entries(JSON.parse(fs.readFileSync(USAGE_PATH, "utf-8"))) as any[];
        this.appCache = [];

        // Populate appCache with dummy WinApp object containing data from the disk
        for (const element of fsUsage) {
            this.appCache.push({
                ...presetApps[0],
                Name: element[0],
                Usage: element[1],
            });
        }

        await this.updateAppCache({ forceRead: true });

        const appCacheHumanReadable = this.appCache.map(obj => {
            const res = { ...obj } as any;
            delete res.Icon;
            return res;
        });

        logger.info(`AppCache: ${JSON.stringify(appCacheHumanReadable, null, 4)}`);

        return this.appCache;
    }

    incrementAppUsage(app: WinApp) {
        app.Usage!++;
        this.appUsageCache[app.Name]++;
    }

    async writeToDisk() {
        fs.writeFileSync(USAGE_PATH, JSON.stringify(this.appUsageCache));
    }

    /**
     * Adds a custom app to WinBoat's application list
     * @param name Name of the app
     * @param path Path of the app
     * @param args Args of the app
     * @param icon Icon of the app
     */
    async addCustomApp(name: string, path: string, args: string, icon: string) {
        const customWinApp: WinApp = {
            Name: name,
            Path: path,
            Args: args,
            Icon: icon,
            Source: "custom",
            Usage: 0,
        };
        this.appCache.push(customWinApp);
        this.appUsageCache[name] = 0;
        await this.writeToDisk();
        this.#wbConfig!.config.customApps = this.#wbConfig!.config.customApps.concat(customWinApp);
    }

    async updateCustomApp(oldName: string, updatedApp: { Name: string; Path: string; Args: string; Icon: string }) {
        this.appCache = this.appCache.map(app => (app.Name === oldName ? { ...app, ...updatedApp } : app));

        // update appUsage if name changed
        if (oldName !== updatedApp.Name) {
            this.appUsageCache[updatedApp.Name] = this.appUsageCache[oldName] ?? 0;
            delete this.appUsageCache[oldName];
        }

        // update persisted app config
        this.#wbConfig!.config.customApps = this.#wbConfig!.config.customApps.map(app =>
            app.Name == oldName ? { ...app, ...updatedApp } : app,
        );

        await this.writeToDisk();
    }

    /**
     * Removes a custom app from WinBoat's application list
     * @param app The app to remove
     */
    async removeCustomApp(app: WinApp) {
        this.appCache = this.appCache.filter(a => a.Name !== app.Name);
        this.appUsageCache = Object.fromEntries(Object.entries(this.appUsageCache).filter(([key]) => key !== app.Name));
        await this.writeToDisk();
        this.#wbConfig!.config.customApps = this.#wbConfig!.config.customApps.filter(a => a.Name !== app.Name);
    }
}

export class Winboat {
    private static instance: Winboat | null = null;
    // Update Intervals
    #healthInterval: NodeJS.Timeout | null = null;
    #metricsInverval: NodeJS.Timeout | null = null;
    #rdpConnectionStatusInterval: NodeJS.Timeout | null = null;
    #qmpInterval: NodeJS.Timeout | null = null;

    // Variables
    isOnline: Ref<boolean> = ref(false);
    isUpdatingGuestServer: Ref<boolean> = ref(false);
    containerStatus: Ref<ContainerStatus> = ref(ContainerStatus.EXITED);
    containerActionLoading: Ref<boolean> = ref(false);
    rdpConnected: Ref<boolean> = ref(false);
    metrics: Ref<Metrics> = ref<Metrics>({
        cpu: {
            usage: 0,
            frequency: 0,
        },
        ram: {
            used: 0,
            total: 0,
            percentage: 0,
        },
        disk: {
            used: 0,
            total: 0,
            percentage: 0,
        },
    });
    readonly #wbConfig: WinboatConfig | null = null;
    appMgr: AppManager | null = null;
    qmpMgr: QMPManager | null = null;
    containerMgr: ContainerManager | null = null;

    static getInstance() {
        Winboat.instance ??= new Winboat();
        return Winboat.instance;
    }

    private constructor() {
        this.#wbConfig = WinboatConfig.getInstance();
        this.containerMgr = createContainer(this.#wbConfig.config.containerRuntime);

        // This is a special interval which will never be destroyed
        setInterval(async () => {
            const _containerStatus = await this.containerMgr!.getStatus();

            if (_containerStatus !== this.containerStatus.value) {
                // ERROR is explicitly set, so don't overwrite it from periodic polling.
                // Keep it until the next user action.
                if (this.containerStatus.value !== ContainerStatus.ERROR) {
                    this.containerStatus.value = _containerStatus;
                    logger.info(`Winboat Container state changed to ${_containerStatus}`);

                    if (_containerStatus === ContainerStatus.RUNNING) {
                        await this.createAPIIntervals();
                    } else {
                        await this.destroyAPIIntervals();
                    }
                }
            }
        }, 1000);

        this.appMgr = new AppManager();
    }

    /**
     * Creates the intervals which rely on the Winboat Guest API.
     */
    async createAPIIntervals() {
        logger.info("Creating Winboat API intervals...");
        const HEALTH_WAIT_MS = 1000;
        const METRICS_WAIT_MS = 1000;
        const RDP_STATUS_WAIT_MS = 1000;

        // *** Health Interval ***
        // Make sure we don't have any existing intervals
        if (this.#healthInterval) {
            clearInterval(this.#healthInterval);
            this.#healthInterval = null;
        }

        this.#healthInterval = setInterval(async () => {
            const _isOnline = await this.getHealth();
            if (_isOnline !== this.isOnline.value) {
                this.isOnline.value = _isOnline;
                logger.info(`Winboat Guest API went ${this.isOnline.value ? "online" : "offline"}`);

                if (this.isOnline.value) {
                    await this.checkVersionAndUpdateGuestServer();
                }
            }
        }, HEALTH_WAIT_MS);

        // *** Metrics Interval ***
        // Make sure we don't have any existing intervals
        if (this.#metricsInverval) {
            clearInterval(this.#metricsInverval);
            this.#metricsInverval = null;
        }

        this.#metricsInverval = setInterval(async () => {
            // If the guest is offline or updating, don't bother checking metrics
            if (!this.isOnline.value || this.isUpdatingGuestServer.value) return;
            this.metrics.value = await this.getMetrics();
        }, METRICS_WAIT_MS);

        // *** RDP Connection Status Interval ***
        // Make sure we don't have any existing intervals
        if (this.#rdpConnectionStatusInterval) {
            clearInterval(this.#rdpConnectionStatusInterval);
            this.#rdpConnectionStatusInterval = null;
        }

        this.#rdpConnectionStatusInterval = setInterval(async () => {
            // If the guest is offline or updating, don't bother checking RDP status
            if (!this.isOnline.value || this.isUpdatingGuestServer.value) return;

            // If RDP monitoring is disabled, don't check status, just set it to false
            if (!this.#wbConfig?.config.rdpMonitoringEnabled) {
                this.rdpConnected.value = false;
                return;
            }

            // Check RDP status
            const _rdpConnected = await this.getRDPConnectedStatus();
            if (_rdpConnected !== this.rdpConnected.value) {
                this.rdpConnected.value = _rdpConnected;
                logger.info(`RDP connection status changed to ${_rdpConnected ? "connected" : "disconnected"}`);
            }
        }, RDP_STATUS_WAIT_MS);

        // *** QMP Interval ***
        // Make sure we don't have any existing intervals
        if (this.#qmpInterval) {
            clearInterval(this.#qmpInterval);
            this.#qmpInterval = null;
        }

        // TODO: Remove if statement once this feature gets rolled out.
        if (this.#wbConfig?.config.experimentalFeatures) {
            this.createQMPInterval();
        }
    }

    /**
     * Destroys the intervals which rely on the Winboat Guest API.
     * This is called when the container is in any state other than Running.
     */
    async destroyAPIIntervals() {
        logger.info("Destroying Winboat API intervals...");
        if (this.#healthInterval) {
            clearInterval(this.#healthInterval);
            this.#healthInterval = null;
            // Side-effect: Set isOnline to false
            this.isOnline.value = false;
        }

        if (this.#metricsInverval) {
            clearInterval(this.#metricsInverval);
            this.#metricsInverval = null;
        }

        if (this.#rdpConnectionStatusInterval) {
            clearInterval(this.#rdpConnectionStatusInterval);
            this.#rdpConnectionStatusInterval = null;
            // Side-effect: Set rdpConnected to false
            this.rdpConnected.value = false;
        }

        if (this.#qmpInterval) {
            clearInterval(this.#qmpInterval);
            this.#qmpInterval = null;

            // Side effect: We must destroy the QMP Manager
            try {
                if (this.qmpMgr && (await this.qmpMgr.isAlive())) {
                    this.qmpMgr.qmpSocket.destroy();
                }
                this.qmpMgr = null;
                logger.info("[destroyAPIIntervals] QMP Manager destroyed because container is no longer running");
            } catch (e) {
                logger.error("[destroyAPIIntervals] Failed to destroy QMP Manager");
                logger.error(e);
            }
        }
    }

    async getHealth() {
        // If /health returns 200, then the guest is ready
        try {
            const res = await nodeFetch(`${WINBOAT_API_URL}/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    async getMetrics() {
        const res = await nodeFetch(`${WINBOAT_API_URL}/metrics`, {
            headers: guestAuthHeaders(),
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        const metrics = (await res.json()) as Metrics;
        return metrics;
    }

    async getRDPConnectedStatus() {
        const res = await nodeFetch(`${WINBOAT_API_URL}/rdp/status`, {
            headers: guestAuthHeaders(),
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        const status = (await res.json()) as { rdpConnected: boolean };
        return status.rdpConnected;
    }

    static readCompose(composePath: string): ComposeConfig {
        const composeFile = fs.readFileSync(composePath, "utf-8");
        const composeContents = YAML.parse(composeFile) as ComposeConfig;
        return composeContents;
    }

    getCredentials() {
        const compose = Winboat.readCompose(this.containerMgr!.composeFilePath);
        return {
            username: compose.services.windows.environment.USERNAME,
            password: compose.services.windows.environment.PASSWORD,
        };
    }

    async #connectQMPManager() {
        try {
            this.qmpMgr = await QMPManager.createConnection("127.0.0.1", HOST_QMP_PORT).catch(e => {
                logger.error(e);
                throw e;
            });
            const capabilities = await this.qmpMgr.executeCommand("qmp_capabilities");
            assert("return" in capabilities);

            const commands = await this.qmpMgr.executeCommand("query-commands");
            // @ts-ignore property "result" already exists due to assert
            assert(commands.return.every(x => "name" in x));
        } catch (e) {
            logger.error("There was an error connecting to QMP");
            logger.error(e);
        }
    }

    createQMPInterval() {
        logger.info("[createQMPInterval] Creating new QMP Interval");
        this.#qmpInterval = setIntervalImmediately(async () => {
            if (!this.#wbConfig?.config.experimentalFeatures) {
                clearInterval(this.#qmpInterval!);
                this.#qmpInterval = null;
                logger.info("[QMPInterval] Destroying self because experimentalFeatures was turned off");
            }

            // If QMP already exists and healthy, we're good
            if (this.qmpMgr && (await this.qmpMgr.isAlive())) return;

            // Otherwise, connect to it since the container is alive but
            // QMP either doesn't exist or is disconnected
            await this.#connectQMPManager();
            logger.info("[QMPInterval] Created new QMP Manager");
        }, QMP_WAIT_MS);
    }

    /**
     * Recreates the WinBoat container from its existing compose file.
     * This is used to recover from a stale/malfunctioning container, e.g. one
     * that references a passed-through USB device that no longer exists on
     * the host, which prevents it from being started normally.
     * @note Mirrors the manual workaround of `container rm` + `compose up`.
     */
    async recreateContainer() {
        logger.warn("[recreateContainer] Recreating WinBoat container from its compose file...");
        await this.containerMgr!.remove();
        await this.containerMgr!.compose("up");
        logger.info("[recreateContainer] Successfully recreated WinBoat container");
    }

    async startContainer() {
        logger.info("Starting WinBoat container...");
        this.containerActionLoading.value = true;

        try {
            // Start the container if it exists and recreate it if starting it runs into an error
            // If there is no container, create it from the compose file
            if (await this.containerMgr!.exists()) {
                try {
                    await this.containerMgr!.container("start");
                } catch (e) {
                    if (isStaleContainerError(e)) {
                        logger.warn(
                            "[startContainer] Container appears to be stale/malfunctioning (e.g. a stale USB passthrough reference). Attempting to recreate it...",
                        );
                        await this.recreateContainer();
                    } else {
                        throw e;
                    }
                }
                logger.info("Successfully started WinBoat container");
            } else {
                try {
                    await this.containerMgr!.compose("up");
                    const recreated = await this.containerMgr!.exists();

                    if (recreated) {
                        logger.info("Successfully recreated the WinBoat container from the existing compose file");
                    } else {
                        logger.error(
                            "Failed to recreate the WinBoat container: it still doesn't exist after 'compose up'",
                        );
                    }
                } catch (e) {
                    logger.error("Failed to recreate the WinBoat container from the existing compose file");
                    logger.error(e);
                    throw e;
                }
            }
        } catch (e) {
            logger.error("There was an error performing the container action.");
            logger.error(e);
            this.containerStatus.value = ContainerStatus.ERROR;
            throw e;
        } finally {
            this.containerActionLoading.value = false;
        }
    }

    async stopContainer() {
        logger.info("Stopping WinBoat container...");
        this.containerActionLoading.value = true;
        try {
            await this.containerMgr!.container("stop");
            logger.info("Successfully stopped WinBoat container");
        } finally {
            this.containerActionLoading.value = false;
        }
    }

    async restartContainer() {
        logger.info("Restarting WinBoat container...");
        this.containerActionLoading.value = true;
        try {
            try {
                await this.containerMgr!.container("restart");
            } catch (e) {
                if (isStaleContainerError(e)) {
                    logger.warn(
                        "[restartContainer] Container appears to be stale/malfunctioning (e.g. a stale USB passthrough reference). Attempting to recreate it...",
                    );
                    await this.recreateContainer();
                } else {
                    throw e;
                }
            }
            logger.info("Successfully restarted WinBoat container");
        } catch (e) {
            logger.error("There was an error restarting the container.");
            logger.error(e);
            this.containerStatus.value = ContainerStatus.ERROR;
            throw e;
        } finally {
            this.containerActionLoading.value = false;
        }
    }

    async pauseContainer() {
        logger.info("Pausing WinBoat container...");
        this.containerActionLoading.value = true;
        try {
            await this.containerMgr!.container("pause");
            logger.info("Successfully paused WinBoat container");
        } finally {
            this.containerActionLoading.value = false;
        }
    }

    async unpauseContainer() {
        logger.info("Unpausing WinBoat container...");
        this.containerActionLoading.value = true;
        try {
            await this.containerMgr!.container("unpause");
            logger.info("Successfully unpaused WinBoat container");
        } finally {
            this.containerActionLoading.value = false;
        }
    }

    // TODO: refactor / possibly remove this
    /**
        Replaces the compose file, and and updates the container.
        @note Use {@link ContainerManager.writeCompose} in case only disk write is needed
    */
    async replaceCompose(composeConfig: ComposeConfig) {
        logger.info("Going to replace compose config");
        this.containerActionLoading.value = true;

        const composeFilePath = this.containerMgr!.composeFilePath;

        // 0. Stop the current container if it's online
        if (this.containerStatus.value === ContainerStatus.RUNNING) {
            await this.stopContainer();
        }

        // 1. Compose down the current container
        await this.containerMgr!.compose("down");

        // 2. Create a backup directory if it doesn't exist
        const backupDir = path.join(WINBOAT_DIR, "backup");

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
            logger.info(`Created compose backup dir: ${backupDir}`);
        }

        // 3. Move the current compose file to backup
        const backupFile = `${Date.now()}-${path.basename(this.containerMgr!.composeFilePath)}`;
        fs.renameSync(composeFilePath, path.join(backupDir, backupFile));
        logger.info(`Backed up current compose at: ${path.join(backupDir, backupFile)}`);

        // 4. Write new compose file
        this.containerMgr!.writeCompose(composeConfig);
        logger.info(`Wrote new compose file to: ${composeFilePath}`);

        // 5. Deploy the container with the new compose file
        await this.containerMgr!.compose("up");

        logger.info("Replace compose config completed, successfully deployed new container");

        this.containerActionLoading.value = false;
    }

    async resetWinboat() {
        console.info("Resetting Winboat...");

        // 1. Stop container
        await this.stopContainer();
        console.info("Stopped container");

        // 2. Remove the container

        await this.containerMgr!.remove();
        console.info("Removed container");

        // 3. Remove the container volume or folder
        const compose = Winboat.readCompose(this.containerMgr!.composeFilePath);
        const storage = compose.services.windows.volumes.find(vol => vol.includes("/storage"));
        if (storage?.startsWith("data:")) {
            if (this.#wbConfig?.config.containerRuntime !== ContainerRuntimes.DOCKER) {
                logger.error("Volume not supported on podman runtime");
            }
            // In this case we have a volume (legacy)
            await execAsync("docker volume rm winboat_data");
            console.info("Removed volume");
        } else {
            const storageFolder = storage?.split(":").at(0) ?? null;
            if (storageFolder && fs.existsSync(storageFolder)) {
                fs.rmSync(storageFolder, { recursive: true, force: true });
                console.info(`Removed storage folder at ${storageFolder}`);
            } else {
                console.warn("Storage folder does not exist, skipping removal");
            }
        }

        // 4. Remove WinBoat directory
        fs.rmSync(WINBOAT_DIR, { recursive: true, force: true });
        console.info(`Removed ${WINBOAT_DIR}`);
        console.info("So long and thanks for all the fish!");
    }

    async launchApp(app: WinApp) {
        if (!this.isOnline.value) throw new Error("Cannot launch app, Winboat is offline");

        if (customAppCallbacks[app.Path]) {
            logger.info(`Found custom app command for '${app.Name}'`);
            customAppCallbacks[app.Path]!(this);
            this.appMgr?.incrementAppUsage(app);
            this.appMgr?.writeToDisk();
            return;
        }

        const cleanAppName = app.Name.replaceAll(/[,.'"]/g, "");
        const { username, password } = this.getCredentials();

        logger.info(`Launching app: ${app.Name} at path ${app.Path}`);

        const freeRDPInstallation = await getFreeRDP();

        // Arguments specified by user to override stock arguments
        const replacementArgs = this.#wbConfig?.config.rdpArgs.filter(a => a.isReplacement);
        // Additional (new) arguments added by user
        const newArgs = this.#wbConfig?.config.rdpArgs.filter(a => !a.isReplacement).map(v => v.newArg) ?? [];
        // The stock arguments after any replacements have been made and new arguments have been added
        const combinedArgs = stockArgs
            .map(argStr =>
                useOriginalIfUndefinedOrNull(replacementArgs?.find(r => argStr === r.original?.trim())?.newArg, argStr),
            )
            .concat(newArgs);
        let args = [`/u:${username}`, `/p:${password}`, `/v:127.0.0.1`, `/port:${HOST_RDP_PORT}`, ...combinedArgs];

        if (app.Path == InternalApps.WINDOWS_DESKTOP) {
            args = args.concat([
                "+f",
                this.#wbConfig?.config.smartcardEnabled ? "/smartcard" : "",
                `/scale:${this.#wbConfig?.config.scale ?? 100}`,
            ]);
        } else {
            args = args.concat([
                this.#wbConfig?.config.multiMonitor === MultiMonitorMode.Span ? "+span" : "",
                "-wallpaper",
                this.#wbConfig?.config.multiMonitor === MultiMonitorMode.MultiMon ? "/multimon" : "",
                `/scale-desktop:${this.#wbConfig?.config.scaleDesktop ?? 100}`,
                `/wm-class:winboat-${cleanAppName}`,
                `/app:program:${app.Path},name:${cleanAppName},cmd:"${app.Args}"`,
            ]);
        }

        args = args.filter((v, _i, _a) => v.trim() !== "");

        this.appMgr?.incrementAppUsage(app);
        this.appMgr?.writeToDisk();

        if (!freeRDPInstallation) {
            logger.error("No FreeRDP installation found");
            return;
        }

        try {
            const safeToLogArgs = freeRDPInstallation.stringifyExec(args).replace(/\/p:[^ ]+/g, "/p:********");
            logger.info(`Launch FreeRDP with command:\n${safeToLogArgs}`);
            await freeRDPInstallation.exec(args);
        } catch (e) {
            const execError = e as ExecFileAsyncError;
            const ERRINFO_RPC_INITIATED_DISCONNECT = 0x00000001;
            const ERRINFO_LOGOFF_BY_USER = 0x0000000c;

            // TODO: Handle all FreeRDP error codes
            // https://github.com/FreeRDP/FreeRDP/blob/3fc1c3ce31b5af1098d15603d7b3fe1c93cf77a5/include/freerdp/error.h#L58
            switch (execError.code) {
                case ERRINFO_RPC_INITIATED_DISCONNECT: {
                    logger.info("FreeRDP connection already established.");
                    logger.info("Creating new session..");
                    break;
                }
                case ERRINFO_LOGOFF_BY_USER: {
                    logger.info("FreeRDP disconnected due to user logging off.");
                    break;
                }
                default: {
                    logger.warn(`FreeRDP process returned error code '${execError.code}'`);
                }
            }
        }
    }

    async checkVersionAndUpdateGuestServer() {
        // 1. Compare the running Guest Server version with the bundled app version.
        const versionRes = await nodeFetch(`${WINBOAT_API_URL}/version`, { headers: guestAuthHeaders() });
        const version = (await versionRes.json()) as GuestServerVersion;
        const appVersion = import.meta.env.VITE_APP_VERSION;

        // Any mismatch triggers an update. This is intentionally not semver-aware:
        // installing an older WinBoat deliberately rolls the guest back to match.
        if (version.version === appVersion) {
            return;
        }
        logger.info(`Guest Server update needed: ${version.version} -> ${appVersion}`);

        // 2. Push the bundled update payload to the Guest Server Updater, which
        //    applies it atomically and rolls back if the new server fails to come
        //    up. Auth is the shared token; the raw zip is the request body.
        this.isUpdatingGuestServer.value = true;
        const zipPath = guestServerUpdateZipPath();
        logger.info(`Sending update payload to the Guest Server Updater: ${zipPath}`);

        try {
            const res = await nodeFetch(`${WINBOAT_UPDATE_URL}/update`, {
                method: "POST",
                headers: {
                    ...guestAuthHeaders(),
                    "Content-Type": "application/octet-stream",
                },
                body: fs.createReadStream(zipPath),
            });
            if (res.status !== 200) {
                throw new Error(`Updater returned ${res.status}: ${await res.text()}`);
            }
            logger.info("Guest Server Updater applied the update successfully");
        } catch (e) {
            logger.error("Failed to apply Guest Server update");
            logger.error(e);
            this.isUpdatingGuestServer.value = false;
            throw e;
        }

        // 3. The updater already health-gated the new server before responding;
        //    this just re-syncs the host's own online view, bounded by a
        //    wall-clock deadline (getHealth itself can block up to FETCH_TIMEOUT).
        let online = await this.getHealth();
        const deadline = Date.now() + GUEST_ONLINE_TIMEOUT_MS;
        while (!online && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            online = await this.getHealth();
        }

        if (online) {
            logger.info("Update completed, Winboat Guest Server is online");
        } else {
            logger.error("Guest Server did not report healthy within the timeout after update");
        }

        this.isUpdatingGuestServer.value = false;
    }

    /**
     * Whether or not the Winboat singleton has a QMP interval active
     */
    get hasQMPInterval() {
        return this.#qmpInterval !== null;
    }
}

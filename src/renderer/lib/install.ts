import { type InstallConfiguration } from "../../types";
import {
    GRAPHICS_PROVISIONING_URL,
    GUEST_TOKEN_PATH,
    HELIOS_DOCKUR_IMAGE,
    MAX_GPU_VRAM_GB,
    NOVNC_URL,
    WINBOAT_API_URL,
    WINBOAT_DIR,
} from "./constants";
import { createLogger } from "../utils/log";
import { guestAuthHeaders, guestServerOemDir } from "../utils/guestServer";
import { createNanoEvents, type Emitter } from "nanoevents";
import { Winboat } from "./winboat";
import { ContainerManager } from "./containers/container";
import { WinboatConfig } from "./config";
import { ContainerRuntimes, createContainer } from "./containers/common";
import { configureGpuContainer } from "./gpu-container";
import { getRenderDevices, hasNvidiaContainerSupport, shouldCheckNvidiaContainerSupport } from "./gpu";

const fs: typeof import("fs") = require("fs");
const path: typeof import("path") = require("path");
const crypto: typeof import("crypto") = require("node:crypto");
const nodeFetch: typeof import("node-fetch").default = require("node-fetch");
const logger = createLogger(path.join(WINBOAT_DIR, "install.log"));

export enum InstallStates {
    IDLE = "Preparing",
    CREATING_COMPOSE_FILE = "Creating Compose File",
    CREATING_OEM = "Creating OEM Assets",
    STARTING_CONTAINER = "Starting Container",
    MONITORING_PREINSTALL = "Monitoring Preinstall",
    INSTALLING_WINDOWS = "Installing Windows",
    PROVISIONING_GPU_DRIVERS = "Provisioning GPU Drivers",
    RESTARTING_FOR_TEST_SIGNING = "Restarting to enable test-signing",
    INSTALLING_GPU_DRIVERS = "Installing GPU Drivers",
    RESTARTING_FOR_GPU_ADAPTER = "Restarting to enable GPU Adapter",
    COMPLETED = "Completed",
    INSTALL_ERROR = "Install Error",
}

interface InstallEvents {
    stateChanged: (state: InstallStates) => void;
    preinstallMsg: (msg: string) => void;
    error: (error: Error) => void;
}

enum GraphicsProvisioningStatus {
    TEST_SIGNING_RESTART_REQUIRED = "test-signing-restart-required",
    DRIVER_RESTART_REQUIRED = "driver-restart-required",
    FINISHED = "finished",
    FAILED = "failed",
}

export class InstallManager {
    conf: InstallConfiguration;
    emitter: Emitter<InstallEvents>;
    state: InstallStates;
    preinstallMsg: string;
    graphicsStatus: string;
    container: ContainerManager;

    constructor(conf: InstallConfiguration) {
        this.conf = conf;
        this.state = InstallStates.IDLE;
        this.preinstallMsg = "";
        this.graphicsStatus = "";
        this.emitter = createNanoEvents<InstallEvents>();
        this.container = createContainer(conf.container);
    }

    changeState(newState: InstallStates) {
        this.state = newState;
        this.emitter.emit("stateChanged", newState);
        logger.info(`New state: "${newState}"`);
    }

    setPreinstallMsg(msg: string) {
        if (msg === this.preinstallMsg) return;
        this.preinstallMsg = msg;
        this.emitter.emit("preinstallMsg", msg);
        logger.info(`Preinstall: "${msg}"`);
    }

    sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async createComposeFile() {
        this.changeState(InstallStates.CREATING_COMPOSE_FILE);

        // Ensure the .winboat directory exists
        if (!fs.existsSync(WINBOAT_DIR)) {
            fs.mkdirSync(WINBOAT_DIR, { recursive: true });
            logger.info(`Created WinBoat directory: ${WINBOAT_DIR}`);
        }

        // Ensure the installation directory exists
        if (!fs.existsSync(this.conf.installFolder)) {
            fs.mkdirSync(this.conf.installFolder, { recursive: true });
            logger.info(`Created installation directory: ${this.conf.installFolder}`);
        }

        // Configure the compose file
        const composeContent = structuredClone(this.container.defaultCompose);

        composeContent.services.windows.environment.RAM_SIZE = `${this.conf.ramGB}G`;
        composeContent.services.windows.environment.CPU_CORES = `${this.conf.cpuCores}`;
        composeContent.services.windows.environment.DISK_SIZE = `${this.conf.diskSpaceGB}G`;
        composeContent.services.windows.environment.VERSION = this.conf.windowsVersion;
        composeContent.services.windows.environment.LANGUAGE = this.conf.windowsLanguage;
        composeContent.services.windows.environment.USERNAME = this.conf.username;
        composeContent.services.windows.environment.PASSWORD = this.conf.password;

        if (this.conf.gpuEnabled) {
            if (this.conf.container !== ContainerRuntimes.DOCKER) {
                throw new Error("Helios GPU acceleration currently requires Docker.");
            }
            if (!/^\/dev\/dri\/renderD\d+$/.test(this.conf.renderDevice) || !fs.existsSync(this.conf.renderDevice)) {
                throw new Error(`The selected GPU render device is unavailable: ${this.conf.renderDevice}`);
            }
            if (
                !Number.isInteger(this.conf.gpuVramGB) ||
                this.conf.gpuVramGB < 1 ||
                this.conf.gpuVramGB > MAX_GPU_VRAM_GB
            ) {
                throw new Error(`GPU video memory must be between 1 and ${MAX_GPU_VRAM_GB} GB.`);
            }

            const renderDevice = (await getRenderDevices()).find(device => device.path === this.conf.renderDevice);
            if (!renderDevice) {
                throw new Error(`Could not inspect the selected GPU render device: ${this.conf.renderDevice}`);
            }
            if (shouldCheckNvidiaContainerSupport(this.conf.gpuEnabled, renderDevice)) {
                if (!renderDevice.nvidiaUuid) {
                    throw new Error(`Could not map ${renderDevice.path} to an NVIDIA GPU UUID through nvidia-smi.`);
                }
                if (!(await hasNvidiaContainerSupport(renderDevice.nvidiaUuid))) {
                    throw new Error(
                        "NVIDIA Container Toolkit is not exposing this GPU to Docker. Configure the NVIDIA runtime or CDI support before enabling Helios on this GPU.",
                    );
                }
            }

            const vramBytes = this.conf.gpuVramGB * 1024 ** 3;
            composeContent.services.windows.image = HELIOS_DOCKUR_IMAGE;
            Object.assign(composeContent.services.windows.environment, {
                HELIOS: "Y",
                HELIOS_BOOTSTRAP: "Y",
                HELIOS_HOSTMEM: `${this.conf.gpuVramGB}G`,
                HELIOS_BLOB_LIMIT: `${this.conf.gpuVramGB}G`,
                RENDERNODE: this.conf.renderDevice,
                VKR_DEVICE_MEMORY_LIMIT_BYTES: `${vramBytes}`,
                override_vram_size: `${this.conf.gpuVramGB * 1024}`,
            });
            if (!composeContent.services.windows.devices.includes(this.conf.renderDevice)) {
                composeContent.services.windows.devices.push(this.conf.renderDevice);
            }
            configureGpuContainer(composeContent.services.windows, renderDevice);
        }

        // Boot image mapping
        if (this.conf.customIsoPath) {
            composeContent.services.windows.volumes.push(`${this.conf.customIsoPath}:/boot.iso`);
        }

        // Storage folder mapping
        const storageFolderIdx = composeContent.services.windows.volumes.findIndex(vol => vol.includes("/storage"));

        if (storageFolderIdx === -1) {
            logger.warn("No /storage volume found in compose template, adding one...");
            composeContent.services.windows.volumes.push(`${this.conf.installFolder}:/storage`);
        } else {
            composeContent.services.windows.volumes[storageFolderIdx] = `${this.conf.installFolder}:/storage`;
        }

        // Shared folder mapping
        const sharedFolderIdx = composeContent.services.windows.volumes.findIndex(vol => vol.includes("/shared"));

        if (!this.conf.sharedFolderPath) {
            // Remove shared folder if not enabled
            if (sharedFolderIdx !== -1) {
                composeContent.services.windows.volumes.splice(sharedFolderIdx, 1);
                logger.info("Removed shared folder as per user configuration");
            }
        } else {
            // Add or update shared folder
            const volumeStr = `${this.conf.sharedFolderPath}:/shared`;

            if (sharedFolderIdx === -1) {
                composeContent.services.windows.volumes.push(volumeStr);
                logger.info(`Added shared folder: ${this.conf.sharedFolderPath}`);
            } else {
                composeContent.services.windows.volumes[sharedFolderIdx] = volumeStr;
                logger.info(`Updated shared folder to: ${this.conf.sharedFolderPath}`);
            }
        }

        // Write the compose file
        this.container.writeCompose(composeContent);
    }

    async createOEMAssets() {
        this.changeState(InstallStates.CREATING_OEM);
        logger.info("Creating OEM assets");

        const oemPath = path.join(WINBOAT_DIR, "oem");

        // OEM assets are generated from scratch so an earlier setup cannot leak
        // optional payloads (notably Helios) into this installation.
        fs.rmSync(oemPath, { recursive: true, force: true });
        fs.mkdirSync(oemPath, { recursive: true });

        // The OEM payload (server\, updater\, install.bat, nssm.exe, ...) is built
        // into the guest server resource's `oem` directory.
        const appPath = guestServerOemDir();

        logger.info(`Guest server source path: ${appPath}`);

        // Check if the source directory exists
        if (!fs.existsSync(appPath)) {
            const error = new Error(`Guest server directory not found at: ${appPath}`);
            logger.error(error.message);
            throw error;
        }
        if (this.conf.gpuEnabled && !fs.existsSync(path.join(appPath, "helios", "Install-Helios.ps1"))) {
            throw new Error("The WinBoat build does not contain the Helios Windows bundle.");
        }

        const copyRecursive = (src: string, dest: string) => {
            const stats = fs.statSync(src);

            if (stats.isDirectory()) {
                // Create directory if it doesn't exist
                if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest, { recursive: true });
                }

                // Copy all contents
                fs.readdirSync(src).forEach(entry => {
                    const srcPath = path.join(src, entry);
                    const destPath = path.join(dest, entry);
                    copyRecursive(srcPath, destPath);
                });

                logger.info(`Copied directory ${src} to ${dest}`);
            } else {
                // Copy file
                fs.copyFileSync(src, dest);
                logger.info(`Copied file ${src} to ${dest}`);
            }
        };

        // Copy all files from guest_server to oemPath
        try {
            fs.readdirSync(appPath).forEach(entry => {
                if (entry === "helios" && !this.conf.gpuEnabled) return;
                const srcPath = path.join(appPath, entry);
                const destPath = path.join(oemPath, entry);
                copyRecursive(srcPath, destPath);
            });
            logger.info("OEM assets created successfully");
        } catch (error) {
            logger.error(`Failed to copy OEM assets: ${error}`);
            throw error;
        }

        // Generate the guest authentication token, will be placed in OEM
        try {
            const token = crypto.randomUUID();
            fs.writeFileSync(GUEST_TOKEN_PATH, token, { encoding: "utf8" });
            fs.writeFileSync(path.join(oemPath, "guest_token"), token, { encoding: "utf8" });
        } catch (error) {
            logger.error(`Failed to create guest token: ${error}`);
            throw error;
        }
    }

    async startContainer() {
        this.changeState(InstallStates.STARTING_CONTAINER);
        logger.info("Starting container...");

        // Start the container
        await this.container.compose("up");

        logger.info("Container started successfully.");
    }

    async monitorContainerPreinstall() {
        // Sleep a bit to make sure the webserver is up in the container
        await this.sleep(3000);

        this.changeState(InstallStates.MONITORING_PREINSTALL);
        logger.info("Starting preinstall monitoring...");

        const re = new RegExp(/>([^<]+)</);
        while (true) {
            try {
                const response = await nodeFetch(`${NOVNC_URL}/msg.html`, {
                    signal: AbortSignal.timeout(500),
                });

                if (response.status === 404) {
                    logger.info("Received 404, preinstall completed");
                    return; // Exit the method when we get 404
                }

                const message = await response.text();
                const messageFormatted = re.exec(message)?.[1] || message;
                this.setPreinstallMsg(messageFormatted);
            } catch (error) {
                if (error instanceof Error && error.message.includes("404")) {
                    logger.info("Received 404, preinstall completed");
                    return; // Exit the method when fetch throws 404
                }

                logger.error(`Error monitoring container: ${error}`);
                throw error;
            }

            // Wait 500ms before next check
            await this.sleep(500);
        }
    }

    async monitorAPIHealth() {
        this.changeState(InstallStates.INSTALLING_WINDOWS);
        logger.info("Waiting for WinBoat Guest Server to wrap up installation...");

        let attempts = 0;

        while (true) {
            const start = performance.now();

            try {
                const res = await nodeFetch(`${WINBOAT_API_URL}/health`, { signal: AbortSignal.timeout(5000) });

                if (res.status === 200) {
                    logger.info("WinBoat Guest Server is up and healthy!");

                    const compose = Winboat.readCompose(this.container.composeFilePath);
                    const filteredVolumes = compose.services.windows.volumes.filter(
                        volume => !volume.endsWith("/boot.iso"),
                    );

                    if (compose.services.windows.volumes.length !== filteredVolumes.length) {
                        compose.services.windows.volumes = filteredVolumes;
                        this.container.writeCompose(compose);
                    }

                    return;
                }

                logger.log(`API request status: ${res.status}`);
            } catch {
                // Connection failures are expected until Windows finishes installing.
            }

            if (++attempts % 12 === 0) {
                logger.info(`API not responding yet, still waiting after ${(attempts * 5) / 60} minutes...`);
            }

            await this.sleep(5000 - (performance.now() - start));
        }
    }

    async waitForGraphicsStatus(expected: GraphicsProvisioningStatus) {
        while (true) {
            let response;
            try {
                response = await nodeFetch(GRAPHICS_PROVISIONING_URL, {
                    headers: guestAuthHeaders(),
                    signal: AbortSignal.timeout(5000),
                });
            } catch {
                // The guest API is expected to disappear while Windows restarts.
                await this.sleep(2000);
                continue;
            }

            if (response.ok) {
                const state = (await response.json()) as { status?: string; message?: string };
                const status = state.status || "waiting";
                if (status !== this.graphicsStatus) {
                    const detail = status === expected ? "" : `; waiting for ${expected}`;
                    logger.info(`Graphics provisioning: ${status}${detail}`);
                    this.graphicsStatus = status;
                }
                if (status === expected) return;
                if (status === GraphicsProvisioningStatus.FAILED) {
                    throw new Error(state.message || "Helios graphics provisioning failed.");
                }
            }

            await this.sleep(2000);
        }
    }

    async restartContainer() {
        await this.container.compose("down");
        await this.container.compose("up");
    }

    async installGraphics() {
        this.changeState(InstallStates.PROVISIONING_GPU_DRIVERS);
        await this.waitForGraphicsStatus(GraphicsProvisioningStatus.TEST_SIGNING_RESTART_REQUIRED);

        this.changeState(InstallStates.RESTARTING_FOR_TEST_SIGNING);
        await this.restartContainer();

        this.changeState(InstallStates.INSTALLING_GPU_DRIVERS);
        await this.waitForGraphicsStatus(GraphicsProvisioningStatus.DRIVER_RESTART_REQUIRED);

        this.changeState(InstallStates.RESTARTING_FOR_GPU_ADAPTER);
        await this.container.compose("down");
        const compose = Winboat.readCompose(this.container.composeFilePath);
        compose.services.windows.environment.HELIOS_BOOTSTRAP = "N";
        this.container.writeCompose(compose);
        await this.container.compose("up");

        await this.waitForGraphicsStatus(GraphicsProvisioningStatus.FINISHED);
    }

    async install() {
        logger.info("Starting installation...");

        try {
            await this.createComposeFile();
            await this.createOEMAssets();
            await this.startContainer();
            await this.monitorContainerPreinstall();
            await this.monitorAPIHealth();
            if (this.conf.gpuEnabled) await this.installGraphics();
        } catch (e) {
            this.changeState(InstallStates.INSTALL_ERROR);
            logger.error("Errors encountered, could not complete the installation steps.");
            logger.error(e);
            return;
        }
        this.changeState(InstallStates.COMPLETED);

        logger.info("Installation completed successfully.");
    }
}

/**
 * Finds the host storage folder configured in the compose file (i.e. the folder
 * mapped to `/storage`, which holds the Windows disk image(s)).
 * @returns `null` if the compose file couldn't be read, no `/storage` volume was
 * found, or the volume points to a legacy Docker named volume rather than a host path.
 */
function findStorageFolderPath(containerRuntime: ContainerManager): string | null {
    if (!fs.existsSync(containerRuntime.composeFilePath)) return null;

    try {
        const compose = Winboat.readCompose(containerRuntime.composeFilePath);
        const storage = compose.services.windows.volumes.find(vol => vol.includes("/storage"));
        const storageFolder = storage?.split(":").at(0) ?? null;

        // Legacy Docker named volume (e.g. "data:/storage") isn't a host path we can inspect directly
        if (!storageFolder || !path.isAbsolute(storageFolder)) return null;

        return storageFolder;
    } catch (e) {
        logger.error("Failed to read compose file while looking for the storage folder");
        logger.error(e);
        return null;
    }
}

/**
 * Checks whether a Windows disk image (e.g. `data.img`, `data2.img`, `data.qcow2`)
 * exists inside the given storage folder.
 */
function hasWindowsDiskImage(storageFolder: string): boolean {
    if (!fs.existsSync(storageFolder)) return false;

    try {
        return fs.readdirSync(storageFolder).some(entry => /^data\d*\.(img|qcow2)$/i.test(entry));
    } catch (e) {
        logger.error(`Failed to read storage folder at '${storageFolder}'`);
        logger.error(e);
        return false;
    }
}

export async function isInstalled(): Promise<boolean> {
    // Check if a winboat container exists
    const config = WinboatConfig.readConfigObject(false);

    if (!config) return false;

    const containerRuntime = createContainer(config.containerRuntime);

    if (await containerRuntime.exists()) {
        return true;
    }

    // The container might be missing even though WinBoat was previously installed
    // e.g. the user might have manually removed the container
    // If the compose file still exists we can probably recreate it
    if (!fs.existsSync(containerRuntime.composeFilePath)) {
        return false;
    }

    // Check the installation for existing files
    const storageFolder = findStorageFolderPath(containerRuntime);
    if (storageFolder && !hasWindowsDiskImage(storageFolder)) {
        logger.warn(
            `Found a WinBoat compose file, but no Windows disk image was found in the storage folder at '${storageFolder}'. Not attempting to recreate the container.`,
        );
        return false;
    }

    logger.info(
        "WinBoat container is missing but installation artifacts (compose file and disk image) were found on disk, attempting to recreate the container...",
    );

    return true;
}

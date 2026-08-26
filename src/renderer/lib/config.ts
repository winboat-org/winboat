const fs: typeof import("fs") = require("node:fs");
const path: typeof import("path") = require("node:path");
import { type WinApp } from "../../types";
import { WINBOAT_DIR } from "./constants";
import { type PTSerializableDeviceInfo } from "./usbmanager";
import { ContainerRuntimes } from "./containers/common";
import { logger } from "./winboat";

export type RdpArg = {
    original?: string;
    newArg: string;
    isReplacement: boolean;
};

export class WinboatVersion {
    public readonly generation: number;
    public readonly major: number;
    public readonly minor: number;
    public readonly alpha: boolean;

    constructor(public readonly versionToken: string) {
        const versionTags = versionToken.split("-");
        const versionNumbers = versionTags[0].split(".").map(value => {
            const parsedValue = parseInt(value);

            if(Number.isNaN(parsedValue)) {
                throw new Error(`Invalid winboat version format: '${versionToken}'`);
            }

            return parsedValue;
        });

        this.alpha = !!versionTags[1]?.includes("alpha");
        this.generation = versionNumbers[0];
        this.major = versionNumbers[1];
        this.minor = versionNumbers[2];
    }

    toString(): string {
        return this.versionToken;
    }

    toJSON(): string {
        return this.toString();
    }
}

type WinboatVersionData = {
    previous: WinboatVersion,
    current: WinboatVersion
}

export enum MultiMonitorMode {
    None = "None",
    MultiMon = "MultiMon",
    Span = "Span"
};

export type WinboatConfigObj = {
    scale: number;
    scaleDesktop: number;
    desktopSize: string,
    smartcardEnabled: boolean;
    rdpMonitoringEnabled: boolean;
    passedThroughDevices: PTSerializableDeviceInfo[];
    customApps: WinApp[];
    experimentalFeatures: boolean;
    advancedFeatures: boolean;
    multiMonitor: MultiMonitorMode;
    rdpArgs: RdpArg[];
    disableAnimations: boolean;
    containerRuntime: ContainerRuntimes;
    versionData: WinboatVersionData;
    appsSortOrder: string;
};

const currentVersion = new WinboatVersion(import.meta.env.VITE_APP_VERSION);

const defaultConfig: WinboatConfigObj = {
    scale: 100,
    scaleDesktop: 100,
    desktopSize: "fullscreen",
    smartcardEnabled: false,
    rdpMonitoringEnabled: false,
    passedThroughDevices: [],
    customApps: [],
    experimentalFeatures: false,
    advancedFeatures: false,
    multiMonitor: MultiMonitorMode.None,
    rdpArgs: [],
    disableAnimations: false,
    // TODO: Ideally should be podman once we flesh out everything
    containerRuntime: ContainerRuntimes.DOCKER,
    versionData: {
        previous: currentVersion, // As of 0.9.0 this won't exist on the filesystem, so we just set it to the current version
        current: currentVersion
    },
    appsSortOrder: 'name',
};

export class WinboatConfig {
    private static readonly configPath: string = path.join(WINBOAT_DIR, "winboat.config.json");
    private static instance: WinboatConfig | null = null;
    
    // Due to us wrapping WinboatConfig in reactive, this can't be private
    configData: WinboatConfigObj = { ...defaultConfig };

    static getInstance() {
        WinboatConfig.instance ??= new WinboatConfig();
        return WinboatConfig.instance;
    }

    private constructor() {
        this.configData = WinboatConfig.readConfigObject()!;

        // Set correct versionData
        if(this.config.versionData.current.versionToken !== currentVersion.versionToken) {
            this.config.versionData.previous = this.config.versionData.current;
            this.config.versionData.current = currentVersion;

            logger.info(`Updated version data from '${this.config.versionData.previous.toString()}' to '${currentVersion.toString()}'`);
        }

        console.log("Reading current config", this.configData);
    }

    get config(): WinboatConfigObj {
        // Return a proxy to intercept property sets
        return new Proxy(this.configData, {
            get: (target, key) => Reflect.get(target, key),
            set: (target, key, value: WinboatConfigObj) => {
                const result = Reflect.set(target, key, value);

                WinboatConfig.writeConfigObject(target);
                console.info("Wrote modified config to disk");

                return result;
            },
        });
    }

    set config(newConfig: WinboatConfigObj) {
        this.configData = { ...newConfig };
        WinboatConfig.writeConfigObject(newConfig);
        console.info("Wrote modified config to disk");
    }

    static writeConfigObject(configObj: WinboatConfigObj): void {
        console.log("writing data: ", configObj);
        fs.writeFileSync(WinboatConfig.configPath, JSON.stringify(configObj, null, 4), "utf-8");
    }

    static readConfigObject(writeDefault = true): WinboatConfigObj | null {
        if (!fs.existsSync(WinboatConfig.configPath)) {
            if (!writeDefault) return null;
            // Also the create the directory because we're not guaranteed to have it
            if (!fs.existsSync(WINBOAT_DIR)) {
                fs.mkdirSync(WINBOAT_DIR, { recursive: true });
            }

            fs.writeFileSync(WinboatConfig.configPath, JSON.stringify(defaultConfig, null, 4), "utf-8");
            return { ...defaultConfig };
        }

        try {
            const rawConfig = fs.readFileSync(WinboatConfig.configPath, "utf-8");
            const configObjRaw = JSON.parse(rawConfig);

            // Parse winboat version data
            if(configObjRaw.versionData) {
                configObjRaw.versionData.current = new WinboatVersion(configObjRaw.versionData.current);
                configObjRaw.versionData.previous = new WinboatVersion(configObjRaw.versionData.previous);
            }

            const configObj = configObjRaw as WinboatConfigObj;

            console.log("Successfully read the config file");

            // Some fields might be missing after an update, so we merge them with the default config
            let hasMissing = false;
            for (const key in defaultConfig) {
                if (!(key in configObj)) {
                    // @ts-expect-error This is valid
                    configObj[key] = defaultConfig[key];
                    hasMissing = true;
                    console.log(
                        `Added missing config key: ${key} with default value: ${
                            JSON.stringify(defaultConfig[key as keyof WinboatConfigObj])
                        }`,
                    );
                }
            }

            // If we have any missing keys, we should just write the config back to disk so those new keys are saved
            // We cannot use this.writeConfig() here since #configData is not populated yet
            if (hasMissing) {
                fs.writeFileSync(WinboatConfig.configPath, JSON.stringify(configObj, null, 4), "utf-8");
                console.log("Wrote updated config with missing keys to disk");
            }

            return { ...configObj };
        } catch (e) {
            console.error("Config’s borked, outputting the default:", e);
            return { ...defaultConfig };
        }
    }
}

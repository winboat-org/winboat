import { type Device } from "usb";
import { type Ref, ref, watch } from "vue";
import { logger, Winboat } from "./winboat";
import { WinboatConfig } from "./config";
import { assert } from "@vueuse/core";
import { getAppPath } from "./electron";

const { usb, getDeviceList }: typeof import("usb") = require("usb");
const fs: typeof import("node:fs") = require("node:fs");
const { execFileSync }: typeof import("node:child_process") = require("node:child_process");
const path: typeof import("node:path") = require("node:path");

type LinuxDeviceDatabase = Record<string, { name: string; devices: Record<string, string> }>;

type DeviceStrings = {
    // Manufacturer or Vendor string
    manufacturer: string | null;
    // Product string
    product: string | null;
};

export type PTSerializableDeviceInfo = {
    // USB Vendor ID
    vendorId: number;
    // USB Product ID;
    productId: number;
} & DeviceStrings;

type VidPidHex = {
    // USB Vendor ID in hex
    vendorIdHex: string;
    // USB Product ID in hex
    productIdHex: string;
};

export class USBManager {
    private static instance: USBManager | null = null;
    // Current list of USB devices
    devices: Ref<Device[]> = ref([]);
    // Current list of passed-through USB devices
    ptDevices: Ref<PTSerializableDeviceInfo[]> = ref([]);
    // ^^ To be kept in sync with WinboatConfig.config.passedThroughDevices

    readonly #linuxDeviceDatabase: LinuxDeviceDatabase = {};
    readonly #deviceStringCache: Map<string, DeviceStrings> = new Map<string, DeviceStrings>();
    readonly #mtpDeviceCache: Map<string, boolean> = new Map<string, boolean>();
    readonly #winboat: Winboat = Winboat.getInstance();
    readonly #wbConfig: WinboatConfig = WinboatConfig.getInstance();

    static getInstance() {
        USBManager.instance ??= new USBManager();
        return USBManager.instance;
    }

    private constructor() {
        this.#linuxDeviceDatabase = readLinuxDeviceDatabase();
        this.devices.value = getDeviceList();
        // Pre-cache existing devices, otherwise on detach we won't have any info about them
        // if they are not in the database
        this.devices.value.forEach(d => this.stringifyDevice(d));
        this.ptDevices.value = this.#wbConfig.config.passedThroughDevices;
        this.#setupDeviceUpdateListeners();
        this.#setupGuestListener();
    }

    /**
     * Sets up listeners for USB device attach and detach events
     */
    #setupDeviceUpdateListeners() {
        usb.on("attach", async (device: Device) => {
            this.devices.value = getDeviceList();
            logger.info(`USB device attached: ${this.stringifyDevice(device)}`);
            if (
                this.#winboat.isOnline.value &&
                this.isDeviceInPassthroughList(device) &&
                !(await this.#QMPCheckIfDeviceExists(
                    device.deviceDescriptor.idVendor,
                    device.deviceDescriptor.idProduct,
                ))
            ) {
                logger.info(`Device is in passthrough list, adding to VM: ${this.stringifyDevice(device)}`);
                await this.#QMPAddDevice(device);
            }
        });

        usb.on("detach", async (device: Device) => {
            this.devices.value = getDeviceList();

            // Remove from MTP cache
            const { vendorIdHex, productIdHex } = this.getDeviceVidPidHex(device);
            const cacheKey = `${vendorIdHex}:${productIdHex}`;
            this.#mtpDeviceCache.delete(cacheKey);

            logger.info(`USB device detached: ${this.stringifyDevice(device)}`);
            if (
                this.#winboat.isOnline.value &&
                this.isDeviceInPassthroughList(device) &&
                (await this.#QMPCheckIfDeviceExists(
                    device.deviceDescriptor.idVendor,
                    device.deviceDescriptor.idProduct,
                ))
            ) {
                logger.info(`Device is in passthrough list, removing from VM: ${this.stringifyDevice(device)}`);
                await this.#QMPRemoveDevice(device.deviceDescriptor.idVendor, device.deviceDescriptor.idProduct);
            }
        });
    }

    /**
     * Sets up the listener responsible for passing through devices in bulk when the guest is online
     */
    #setupGuestListener() {
        // TODO: This should depend on QMP Manager instead, but that approach also has subtle pitfalls
        // We are not guaranteed at this point to have a QMP Manager
        watch(this.#winboat.isOnline, async (isOnline: boolean) => {
            if (!isOnline) return;

            logger.info("Guest is online, passing through devices");
            // Pass through any devices that are in the passthrough list & connected
            for (const ptDevice of this.#wbConfig.config.passedThroughDevices) {
                if (
                    this.isPTDeviceConnected(ptDevice) &&
                    !(await this.#QMPCheckIfDeviceExists(ptDevice.vendorId, ptDevice.productId))
                ) {
                    logger.info(
                        `Pass-through device ${this.stringifyPTSerializableDevice(ptDevice)} is connected, adding to VM`,
                    );
                    const device = this.devices.value.find(
                        d =>
                            d.deviceDescriptor.idVendor === ptDevice.vendorId &&
                            d.deviceDescriptor.idProduct === ptDevice.productId,
                    )!;
                    await this.#QMPAddDevice(device);
                }
            }
        });
    }

    /**
     * Turns a USB device into a human-readable string
     * @param device The USB device to stringify
     * @returns A human-readable string representing the USB device
     */
    stringifyDevice(device: Device): string {
        const { vendorIdHex, productIdHex } = this.getDeviceVidPidHex(device);

        // Check cache first
        const cacheKey = `${vendorIdHex}:${productIdHex}`;
        if (this.#deviceStringCache.has(cacheKey)) {
            const cached = this.#deviceStringCache.get(cacheKey)!;
            return `[${vendorIdHex}:${productIdHex}] ${cached.manufacturer || "Unknown Vendor"} | ${
                cached.product || "Unknown Product"
            }`;
        }

        let vendor = this.#linuxDeviceDatabase[vendorIdHex];
        let product = vendor?.devices[productIdHex];

        // Many devices are not included in the database, but the device itself may have string descriptors
        // Unfortunately, we don't seem to have permission to open the devices directly to read the string descriptors
        // directly through the USB library, so we have to use lsusb as a fallback
        try {
            if (!product) {
                const deviceStrings = getDeviceStringsFromLsusb(vendorIdHex, productIdHex);
                product = deviceStrings.product!;
            }

            if (!vendor?.name) {
                const deviceStrings = getDeviceStringsFromLsusb(vendorIdHex, productIdHex);

                if (deviceStrings.manufacturer) {
                    vendor = { name: deviceStrings.manufacturer, devices: {} };
                }
            }
        } catch (e) {
            logger.error(`Error fetching string descriptors for USB device ${vendorIdHex}:${productIdHex}`);
            logger.error(e);
        }

        this.#deviceStringCache.set(`${vendorIdHex}:${productIdHex}`, {
            manufacturer: vendor?.name || null,
            product: product || null,
        });

        // Format: [VID:PID] Vendor Name | Product Name
        return `[${vendorIdHex}:${productIdHex}] ${vendor ? vendor.name : "Unknown Vendor"} | ${product || "Unknown Product"}`;
    }

    /**
     * Converts a pass-through serializable device info object to a human-readable string
     * @param device The PTSerializableDeviceInfo object to stringify
     * @returns A human-readable string representing the USB device
     */
    stringifyPTSerializableDevice(device: PTSerializableDeviceInfo): string {
        const { vendorIdHex, productIdHex } = this.getDeviceVidPidHex(device);

        // Format: [VID:PID] Vendor Name | Product Name
        return `[${vendorIdHex}:${productIdHex}] ${device.manufacturer || "Unknown Vendor"} | ${
            device.product || "Unknown Product"
        }`;
    }

    /**
     * Converts a USB device to a pass-through serializable device info object
     * @param device The USB device to convert
     * @returns A PTSerializableDeviceInfo object representing the USB device
     */
    #convertDeviceToPTSerializable(device: Device): PTSerializableDeviceInfo {
        const { vendorIdHex, productIdHex } = this.getDeviceVidPidHex(device);

        const deviceStrings = this.#deviceStringCache.get(`${vendorIdHex}:${productIdHex}`);

        if (!deviceStrings) {
            throw new Error(`Device strings for device ${vendorIdHex}:${productIdHex} not found in cache.\
                Make sure to call stringifyDevice() at least once before converting.`);
        }

        return {
            vendorId: device.deviceDescriptor.idVendor,
            productId: device.deviceDescriptor.idProduct,
            ...this.#deviceStringCache.get(`${vendorIdHex}:${productIdHex}`)!,
        };
    }

    /**
     * Adds a USB device to the passthrough list
     * @param device The USB device to add
     */
    async addDeviceToPassthroughList(device: Device) {
        const ptDevice = this.#convertDeviceToPTSerializable(device);

        // Avoid duplicates
        if (
            this.#wbConfig.config.passedThroughDevices.some(
                d => d.vendorId === ptDevice.vendorId && d.productId === ptDevice.productId,
            )
        ) {
            throw new Error(
                `Device "${ptDevice.manufacturer} | ${ptDevice.product}" is already in the passthrough list`,
            );
        }

        // Push doesn't properly track reactivity, so we use concat instead
        this.#wbConfig.config.passedThroughDevices = this.#wbConfig.config.passedThroughDevices.concat(ptDevice);
        this.ptDevices.value = this.#wbConfig.config.passedThroughDevices;

        if (
            this.#winboat.isOnline.value &&
            !(await this.#QMPCheckIfDeviceExists(ptDevice.vendorId, ptDevice.productId))
        ) {
            await this.#QMPAddDevice(device);
        }

        logger.info(`Added device "${ptDevice.manufacturer} | ${ptDevice.product}" to passthrough list`);
    }

    /**
     * Removes a USB device from the passthrough list
     * @param ptDevice The device's PTSerializableDeviceInfo object to remove
     */
    async removeDeviceFromPassthroughList(ptDevice: PTSerializableDeviceInfo) {
        this.#wbConfig.config.passedThroughDevices = this.#wbConfig.config.passedThroughDevices.filter(
            d => d.vendorId !== ptDevice.vendorId || d.productId !== ptDevice.productId,
        );
        this.ptDevices.value = this.#wbConfig.config.passedThroughDevices;

        if (
            this.#winboat.isOnline.value &&
            (await this.#QMPCheckIfDeviceExists(ptDevice.vendorId, ptDevice.productId))
        ) {
            await this.#QMPRemoveDevice(ptDevice.vendorId, ptDevice.productId);
        }

        logger.info(`Removed device "${ptDevice.manufacturer} | ${ptDevice.product}" from passthrough list`);
    }

    /**
     * Determines if a USB device is in the passthrough list
     * @param device The USB device to check
     * @returns A boolean indicating whether the device is in the passthrough list
     */
    isDeviceInPassthroughList(device: Device): boolean {
        const ptDevice = this.#convertDeviceToPTSerializable(device);
        return this.#wbConfig.config.passedThroughDevices.some(
            d => d.vendorId === ptDevice.vendorId && d.productId === ptDevice.productId,
        );
    }

    /**
     * Determines if a pass-through device is connected
     * @param ptDevice The PTSerializableDeviceInfo object to check
     * @returns A boolean indicating whether the device is connected
     */
    isPTDeviceConnected(ptDevice: PTSerializableDeviceInfo): boolean {
        return this.devices.value.some(
            d =>
                d.deviceDescriptor.idVendor === ptDevice.vendorId &&
                d.deviceDescriptor.idProduct === ptDevice.productId,
        );
    }

    /**
     * Removes all passed through devices from the passthrough list
     * and the WinBoat configuration object
     */
    async removeAllPassthroughDevicesAndConfig() {
        for (const device of this.ptDevices.value) {
            await this.removeDeviceFromPassthroughList(device);
        }
        this.#wbConfig.config.passedThroughDevices = [];
        this.ptDevices.value = [];
    }

    /**
     * Checks whether a {@link PTSerializableDeviceInfo} object or {@link Device} USB device is an MTP device or not
     * @param device {@link PTSerializableDeviceInfo} object or {@link Device} USB device
     */
    isMTPDevice(device: PTSerializableDeviceInfo): boolean;
    isMTPDevice(device: Device): boolean;
    isMTPDevice(device: PTSerializableDeviceInfo | Device) {
        const { vendorIdHex, productIdHex } = this.getDeviceVidPidHex(device);

        // Check cache first
        const cacheKey = `${vendorIdHex}:${productIdHex}`;
        const cacheEntry = this.#mtpDeviceCache.get(cacheKey);
        if (this.#mtpDeviceCache.get(cacheKey) !== undefined) {
            return cacheEntry!;
        }

        // If the device is not a PTSerializableDeviceInfo & not connected
        if ("vendorId" in device && !this.isPTDeviceConnected(device)) {
            return false;
        }

        // Lookup MTP
        const lsusbOutput = execFileSync("lsusb", ["-vd", `${vendorIdHex}:${productIdHex}`], { encoding: "utf8" });
        const isMTP = lsusbOutput.includes("MTP");

        // Set cache and return
        this.#mtpDeviceCache.set(cacheKey, isMTP);
        return isMTP;
    }

    /**
     * Gets the Vendor ID and Product ID of a {@link PTSerializableDeviceInfo} object or {@link Device} USB device
     * @param device The {@link PTSerializableDeviceInfo} object or {@link Device} USB device to check
     */
    getDeviceVidPidHex(device: PTSerializableDeviceInfo | Device): VidPidHex {
        const ret = { vendorIdHex: "", productIdHex: "" };
        if ("vendorId" in device) {
            ret.vendorIdHex = device.vendorId.toString(16).padStart(4, "0");
            ret.productIdHex = device.productId.toString(16).padStart(4, "0");
        } else {
            ret.vendorIdHex = device.deviceDescriptor.idVendor.toString(16).padStart(4, "0");
            ret.productIdHex = device.deviceDescriptor.idProduct.toString(16).padStart(4, "0");
        }

        return ret;
    }

    async #QMPCheckIfDeviceExists(vendorId: number, productId: number): Promise<boolean> {
        let response = null;
        try {
            response = await this.#winboat.qmpMgr!.executeCommand("human-monitor-command", {
                "command-line": "info qtree",
            });
            assert("result" in response);

            // @ts-ignore property "result" already exists due to assert
            return response.return.includes(`usb-host, id "${vendorId}:${productId}"`);
        } catch (e) {
            logger.error(`There was an error checking whether USB device '${vendorId}:${productId}' exists`);
            logger.error(e);
            logger.error(`QMP response: ${JSON.stringify(response)}`);
        }
        return false;
    }

    // TODO: handle hostaddr/hostbus in case of duplicate VID/PID
    async #QMPAddDevice(device: Device) {
        let response = null;
        const vendorid = device.deviceDescriptor.idVendor;
        const productid = device.deviceDescriptor.idProduct;
        const deviceBusPath = `/dev/bus/usb/${String(device.busNumber).padStart(3, "0")}/${String(
            device.deviceAddress,
        ).padStart(3, "0")}`;

        if (this.isMTPDevice(device)) {
            freeMTPDevice(deviceBusPath);
        }

        try {
            response = await this.#winboat.qmpMgr!.executeCommand("device_add", {
                driver: "usb-host",
                id: `${vendorid}:${productid}`, // TODO: get rid of this when we support multiple devices of the same kind
                vendorid,
                productid,
                hostdevice: deviceBusPath,
            });

            assert("result" in response);
        } catch (e) {
            logger.error(`There was an error adding USB device '${vendorid}:${productid}'`);
            logger.error(e);
            logger.error(`QMP response: ${JSON.stringify(response)}`);
        }
        logger.info("QMPAddDevice", vendorid, productid);
    }

    async #QMPRemoveDevice(vendorId: number, productId: number) {
        let response = null;
        try {
            response = await this.#winboat.qmpMgr!.executeCommand("device_del", { id: `${vendorId}:${productId}` });
            assert("result" in response);
        } catch (e) {
            logger.error(`There was an error removing USB device '${vendorId}:${productId}'`);
            logger.error(e);
            logger.error(`QMP response: ${JSON.stringify(response)}`);
        }
        logger.info("QMPRemoveDevice", vendorId, productId);
    }
}

/**
 * Reads the Linux USB device database and returns a JSON representation.
 * @returns A JSON object representing the USB device database
 */
function readLinuxDeviceDatabase(): LinuxDeviceDatabase {
    const LINUX_DEVICE_DATABASE_PATH = "/usr/share/hwdata/usb.ids";
    let dbFilePath = LINUX_DEVICE_DATABASE_PATH;

    // Fallback to static file if the distro doesn't ship with usb.ids
    if (!fs.existsSync(dbFilePath)) {
        dbFilePath = import.meta.env.PROD
            ? path.join(process.resourcesPath, "data", "usb.ids") // For packaged app
            : path.join(getAppPath(), "..", "..", "data", "usb.ids"); // For dev mode
    }

    logger.info(`Final USB database file path: ${dbFilePath}`);

    const content = fs.readFileSync(dbFilePath, "utf-8");
    const lines = content.split("\n");

    const vendors: LinuxDeviceDatabase = {};
    let currentVendor = null;

    const vendorRegex = new RegExp(/^([0-9a-f]{4})\s+(.+)$/i);
    const deviceRegex = new RegExp(/^\t([0-9a-f]{4})\s+(.+)$/i);
    for (const line of lines) {
        if (line.startsWith("#") || line.trim() === "") continue;

        if (!line.startsWith("\t")) {
            // Vendor line
            const match = vendorRegex.exec(line);
            if (match) {
                currentVendor = match[1].toLowerCase();
                vendors[currentVendor] = {
                    name: match[2].trim(),
                    devices: {},
                };
            }
        } else if (line.startsWith("\t") && line[1] !== "\t") {
            // Device line
            const match = deviceRegex.exec(line);
            if (match && currentVendor) {
                vendors[currentVendor].devices[match[1].toLowerCase()] = match[2].trim();
            }
        }
    }

    return vendors;
}

/**
 * Retrieves the manufacturer and product strings for a USB device using the `lsusb` command.
 * @param vidHex The vendor ID in hexadecimal format (4 characters, e.g. "1a2b")
 * @param pidHex The product ID in hexadecimal format (4 characters, e.g. "1a2b")
 * @returns An object containing the manufacturer and product strings (nulled fields if not found)
 */
function getDeviceStringsFromLsusb(vidHex: string, pidHex: string): DeviceStrings {
    try {
        // Run lsusb -v for the specific device, suppress stderr
        const lsusbOutput = execFileSync("lsusb", ["-d", `${vidHex}:${pidHex}`, "-v"], { encoding: "utf8" });

        // Parse manufacturer string
        const manufacturerMatch = new RegExp(/^\s*iManufacturer\s+\d+\s+(.+)$/m).exec(lsusbOutput);
        const manufacturer = manufacturerMatch ? manufacturerMatch[1].trim() : null;

        // Parse product string
        const productMatch = new RegExp(/^\s*iProduct\s+\d+\s+(.+)$/m).exec(lsusbOutput);
        const product = productMatch ? productMatch[1].trim() : null;

        return { manufacturer, product };
    } catch (error) {
        // lsusb failed (device not found, no permissions, etc.)
        logger.error(`Failed to get device strings for ${vidHex}:${pidHex}:`, error);
        return { manufacturer: null, product: null };
    }
}

/**
 * Tries to free the MTP device found on `deviceBus`
 * @param deviceBus The device bus to free
 */
function freeMTPDevice(deviceBus: string) {
    try {
        const fuserOutput = execFileSync("fuser", ["-k", deviceBus], { encoding: "utf8" });
        if (fuserOutput.includes(deviceBus)) {
            logger.info(`[freeMTPDevice] Freed device at bus ${deviceBus}`);
        }
    } catch {
        logger.info(`[freeMTPDevice] Device at ${deviceBus} either doesn't need freeing or couldn't be freed`);
    }
}

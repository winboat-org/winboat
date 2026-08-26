<template>
    <div class="flex flex-col gap-10 overflow-x-hidden" :class="{ hidden: !maxNumCores }">
        <div>
            <x-label class="mb-4 text-neutral-300">Container</x-label>
            <div class="flex flex-col gap-4">
                <!-- RAM Allocation -->
                <ConfigCard
                    icon="game-icons:ram"
                    title="RAM Allocation"
                    desc="How many gigabytes of RAM are allocated to the Windows virtual machine"
                    type="number"
                    unit="GB"
                    :min="MIN_VM_RAM_GB"
                    :max="maxRamGB"
                    v-model:value="ramGB"
                />

                <!-- CPU Cores -->
                <ConfigCard
                    icon="solar:cpu-bold"
                    title="CPU Cores"
                    desc="How many CPU Cores are allocated to the Windows virtual machine"
                    type="number"
                    unit="Cores"
                    :min="2"
                    :max="maxNumCores"
                    v-model:value="numCores"
                />

                <!-- Shared Folder -->
                <ConfigCard
                    icon="fluent:folder-link-32-filled"
                    title="Shared Folder"
                    type="switch"
                    v-model:value="shareFolder"
                >
                    <template v-slot:desc>
                        If enabled, you will be able to access your selected folder within Windows under
                        <span class="font-mono bg-neutral-700 rounded-md px-1 py-0.5">Network\host.lan</span>
                    </template>
                </ConfigCard>

                <!-- Shared Folder Location -->
                <ConfigCard
                    v-if="shareFolder"
                    icon="mdi:folder-cog"
                    title="Shared Folder Location"
                    type="custom"
                >
                    <template v-slot:desc>
                        <span v-if="sharedFolderPath">
                            Currently sharing: <span class="font-mono bg-neutral-700 rounded-md px-1 py-0.5">{{ sharedFolderPath }}</span>
                        </span>
                        <span v-else>
                            Select a folder to share with Windows
                        </span>
                    </template>
                    <x-button @click="selectSharedFolder">
                        Browse
                    </x-button>
                </ConfigCard>

                <!-- Auto Start Container -->
                <ConfigCard
                    icon="clarity:power-solid"
                    title="Auto Start Container"
                    desc="If enabled, the Windows container will automatically be started when the system boots up"
                    type="switch"
                    v-model:value="autoStartContainer"
                />

                <div class="flex flex-col">
                    <p class="my-0 text-yellow-500" v-for="(warning, k) of warnings" :key="`warning-${k}`">
                        ⚠ {{ warning }}
                    </p>
                    <p class="my-0 text-red-500" v-for="(error, k) of errors" :key="`error-${k}`">❗ {{ error }}</p>
                </div>
                <x-button
                    :disabled="saveButtonDisabled || isUpdatingUSBPrerequisites"
                    @click="saveCompose()"
                    class="w-24"
                >
                    <span v-if="!isApplyingChanges || isUpdatingUSBPrerequisites">Save</span>
                    <x-throbber v-else class="w-10"></x-throbber>
                </x-button>
            </div>
        </div>
        <div v-show="wbConfig.config.experimentalFeatures">
            <x-label class="mb-4 text-neutral-300">Devices</x-label>
            <div class="flex flex-col gap-4">
                <!-- USB Passthrough -->
                <x-card
                    class="flex relative z-20 flex-row justify-between items-center p-2 py-3 my-0 w-full backdrop-blur-xl backdrop-brightness-150 bg-neutral-800/20"
                >
                    <div class="w-full">
                        <div class="flex flex-row gap-2 items-center mb-2">
                            <Icon class="inline-flex text-violet-400 size-8" icon="fluent:tv-usb-24-filled"></Icon>
                            <h1 class="my-0 text-lg font-semibold">
                                USB Passthrough
                                <span class="bg-violet-500 rounded-full px-3 py-0.5 text-sm ml-2"> Experimental </span>
                            </h1>
                        </div>

                        <template v-if="usbPassthroughDisabled || isUpdatingUSBPrerequisites">
                            <x-card
                                class="flex items-center py-2 w-full my-2 backdrop-blur-xl gap-4 backdrop-brightness-150 bg-yellow-200/10"
                            >
                                <Icon class="inline-flex text-yellow-500 size-8" icon="clarity:warning-solid"></Icon>
                                <h1 class="my-0 text-base font-normal text-yellow-200">
                                    We need to update your Compose in order to use this feature!
                                </h1>

                                <x-button
                                    :disabled="isUpdatingUSBPrerequisites"
                                    class="mt-1 !bg-gradient-to-tl from-yellow-200/20 to-transparent ml-auto hover:from-yellow-300/30 transition !border-0"
                                    @click="addRequiredComposeFieldsUSB"
                                >
                                    <x-label
                                        class="ext-lg font-normal text-yellow-200"
                                        v-if="!isUpdatingUSBPrerequisites"
                                    >
                                        Update
                                    </x-label>

                                    <x-throbber v-else class="w-8 text-yellow-300"></x-throbber>
                                </x-button>
                            </x-card>
                        </template>
                        <template v-if="wbConfig.config.containerRuntime === ContainerRuntimes.PODMAN">
                            <x-card
                                class="flex items-center py-2 w-full my-2 backdrop-blur-xl gap-4 backdrop-brightness-150 bg-yellow-200/10"
                            >
                                <Icon class="inline-flex text-yellow-500 size-8" icon="clarity:warning-solid"></Icon>
                                <h1 class="my-0 text-base font-normal text-yellow-200">
                                    USB Passthrough is not yet supported while using Podman as the container runtime.
                                </h1>
                            </x-card>
                        </template>
                        <template
                            v-if="
                                !usbPassthroughDisabled &&
                                !isUpdatingUSBPrerequisites &&
                                wbConfig.config.containerRuntime === ContainerRuntimes.DOCKER
                            "
                        >
                            <x-label
                                class="text-neutral-400 text-[0.9rem] !pt-0 !mt-0"
                                v-if="usbManager.ptDevices.value.length == 0"
                            >
                                Press the button below to add USB devices to your passthrough list
                            </x-label>
                            <TransitionGroup name="devices" tag="x-box" class="flex-col gap-2 mt-4">
                                <x-card
                                    class="flex justify-between items-center px-2 py-0 m-0 bg-white/5"
                                    v-for="device of usbManager.ptDevices.value"
                                    :key="`${device.vendorId}-${device.productId}`"
                                    :class="{
                                        'bg-white/[calc(0.05*0.75)] [&_*:not(div):not(span)]:opacity-75':
                                            !usbManager.isPTDeviceConnected(device),
                                    }"
                                >
                                    <div class="flex flex-row gap-2 items-center">
                                        <span
                                            v-if="
                                                usbManager.isMTPDevice(device) ||
                                                usbManager
                                                    .stringifyPTSerializableDevice(device)
                                                    .toLowerCase()
                                                    .includes('mtp')
                                            "
                                            class="relative group"
                                        >
                                            <Icon
                                                icon="clarity:warning-solid"
                                                class="text-yellow-300 size-7 cursor-pointer"
                                            />
                                            <span
                                                class="absolute bottom-5 z-50 w-[320px] bg-neutral-800/90 backdrop-blur-sm text-xs text-gray-300 rounded-lg shadow-lg px-3 py-2 hidden group-hover:block transition-opacity duration-200 pointer-events-none"
                                            >
                                                This device appears to be using the MTP protocol, which is known for
                                                being problematic. Some Desktop Environments automatically mount MTP
                                                devices, which in turn causes WinBoat to not be able to pass the device
                                                through.
                                            </span>
                                        </span>

                                        <span v-if="!usbManager.isPTDeviceConnected(device)" class="relative group">
                                            <Icon
                                                icon="ix:connection-fail"
                                                class="text-red-500 size-7 cursor-pointer"
                                            />
                                            <span
                                                class="absolute bottom-5 z-50 w-[320px] bg-neutral-800/90 backdrop-blur-sm text-xs text-gray-300 rounded-lg shadow-lg px-3 py-2 hidden group-hover:block transition-opacity duration-200 pointer-events-none"
                                            >
                                                This device is currently not connected.
                                            </span>
                                        </span>

                                        <p class="text-base !m-0 text-gray-200">
                                            {{ usbManager.stringifyPTSerializableDevice(device) }}
                                        </p>
                                    </div>
                                    <x-button
                                        @click="removeDevice(device)"
                                        class="mt-1 !bg-gradient-to-tl from-red-500/20 to-transparent hover:from-red-500/30 transition !border-0"
                                    >
                                        <x-icon href="#remove"></x-icon>
                                    </x-button>
                                </x-card>
                            </TransitionGroup>
                            <x-button
                                v-if="availableDevices.length > 0"
                                class="!bg-gradient-to-tl from-blue-400/20 shadow-md shadow-blue-950/20 to-transparent hover:from-blue-400/30 transition"
                                :class="{ 'mt-4': usbManager.ptDevices.value.length }"
                                @click="refreshAvailableDevices()"
                            >
                                <x-icon href="#add"></x-icon>
                                <x-label>Add Device</x-label>
                                <TransitionGroup ref="usbMenu" name="menu" tag="x-menu" class="max-h-52">
                                    <x-menuitem
                                        v-for="(device, k) of availableDevices as Device[]"
                                        :key="device.portNumbers.join(',')"
                                        @click="addDevice(device)"
                                    >
                                        <x-label>{{ usbManager.stringifyDevice(device) }}</x-label>
                                    </x-menuitem>
                                    <x-menuitem v-if="availableDevices.length === 0" disabled>
                                        <x-label>No available devices</x-label>
                                    </x-menuitem>
                                </TransitionGroup>
                            </x-button>
                        </template>
                    </div>
                </x-card>
            </div>
        </div>
        <div v-show="wbConfig.config.advancedFeatures">
            <x-label class="mb-4 text-neutral-300">FreeRDP</x-label>
            <div class="flex flex-col gap-4">
                <!-- RDP args -->
                <x-card
                    class="flex flex-row justify-between items-center p-2 py-3 my-0 w-full backdrop-blur-xl backdrop-brightness-150 bg-neutral-800/20"
                >
                    <div class="w-full">
                        <div class="flex flex-row gap-2 items-center mb-2">
                            <Icon class="inline-flex text-violet-400 size-8" icon="fluent:tv-24-filled"></Icon>
                            <h1 class="my-0 text-lg font-semibold">
                                FreeRDP Arguments
                                <span class="bg-blue-500 rounded-full px-3 py-0.5 text-sm ml-2"> Advanced </span>
                            </h1>
                        </div>

                        <x-label
                            v-if="wbConfig.config.rdpArgs.length == 0"
                            class="text-neutral-400 text-[0.9rem] !pt-0 !mt-0"
                        >
                            Press the buttons below to add arguments to FreeRDP, you can choose to either add a new
                            argument or modify an existing one to your liking via replacement
                        </x-label>
                        <TransitionGroup name="devices" tag="x-box" class="flex-col gap-2 mt-4">
                            <x-card
                                class="flex justify-between items-center gap-2 px-2 py-0 m-0 bg-white/5"
                                v-for="(arg, index) in wbConfig.config.rdpArgs"
                                :key="index"
                            >
                                <div class="grid grid-cols-2 gap-2 items-center w-full">
                                    <x-input
                                        type="text"
                                        class="!max-w-full"
                                        v-if="arg.isReplacement"
                                        :value="arg.original"
                                        @input="(e: any) => (arg.original = e.target.value)"
                                    >
                                        <x-label>Original Argument</x-label>
                                    </x-input>
                                    <x-input
                                        type="text"
                                        class="!max-w-full !mt-0"
                                        :class="{ 'col-span-2': !arg.isReplacement }"
                                        :value="arg.newArg"
                                        @input="(e: any) => (arg.newArg = e.target.value)"
                                    >
                                        <x-label>New Argument</x-label>
                                    </x-input>
                                </div>
                                <x-button
                                    class="mt-1 !bg-gradient-to-tl from-red-500/20 to-transparent hover:from-red-500/30 transition !border-0"
                                    @click="wbConfig.config.rdpArgs.splice(index, 1)"
                                >
                                    <x-icon href="#remove"></x-icon>
                                </x-button>
                            </x-card>
                        </TransitionGroup>
                        <div class="flex flex-row gap-2" :class="{ 'mt-4': wbConfig.config.rdpArgs.length }">
                            <x-button
                                class="!bg-gradient-to-tl from-blue-400/20 shadow-md shadow-blue-950/20 to-transparent hover:from-blue-400/30 transition"
                                @click="wbConfig.config.rdpArgs.push({ newArg: '', isReplacement: false })"
                            >
                                <x-icon href="#add"></x-icon>
                                <x-label>Add Argument</x-label>
                            </x-button>
                            <x-button
                                class="!bg-gradient-to-tl from-yellow-400/20 shadow-md shadow-yellow-950/20 to-transparent hover:from-yellow-400/30 transition"
                                @click="wbConfig.config.rdpArgs.push({ newArg: '', original: '', isReplacement: true })"
                            >
                                <Icon class="inline-flex size-6" icon="codex:replace" />
                                <x-label>Replace Argument</x-label>
                            </x-button>
                        </div>
                    </div>
                </x-card>
            </div>
        </div>
        <div>
            <x-label class="mb-4 text-neutral-300">General</x-label>
            
            <div class="flex flex-col gap-4">

                <!-- Desktop Size -->
                <x-card
                    class="flex relative z-30 flex-row justify-between items-center p-2 py-3 my-0 w-full backdrop-blur-xl backdrop-brightness-150 bg-neutral-800/20"
                >
                    <div>
                        <div class="flex flex-row gap-2 items-center mb-2">
                            <Icon class="inline-flex text-violet-400 size-8" icon="uil:desktop"></Icon>
                            <h1 class="my-0 text-lg font-semibold">Desktop Size</h1>
                        </div>
                        <p class="text-neutral-400 text-[0.9rem] !pt-0 !mt-0">
                            Controls what size the Windows desktop interface is.
                        </p>
                    </div>
                    <div class="flex flex-row gap-2 justify-center items-center">
                        <x-select
                            class="w-200"
                            @change="(e: any) => (wbConfig.config.desktopSize = String(e.detail.newValue))"
                        >
                            <x-menu>
                                <x-menuitem value="fullscreen" :toggled="wbConfig.config.desktopSize === 'fullscreen'">
                                    <x-label>Fullscreen</x-label>
                                </x-menuitem>
                                <x-menuitem value="3840x2160" :toggled="wbConfig.config.desktopSize === '3840x2160'">
                                    <x-label>3840x2160</x-label>
                                </x-menuitem>
                                <x-menuitem value="2560x1440" :toggled="wbConfig.config.desktopSize === '2560x1440'">
                                    <x-label>2560x1440</x-label>
                                </x-menuitem>
                                <x-menuitem value="1920x1080" :toggled="wbConfig.config.desktopSize === '1920x1080'">
                                    <x-label>1920x1080</x-label>
                                </x-menuitem>
                                <x-menuitem value="1680x1050" :toggled="wbConfig.config.desktopSize === '1680x1050'">
                                    <x-label>1680x1050</x-label>
                                </x-menuitem>
                                <x-menuitem value="1600x900" :toggled="wbConfig.config.desktopSize === '1600x900'">
                                    <x-label>1600x900</x-label>
                                </x-menuitem>
                                <x-menuitem value="1536x864" :toggled="wbConfig.config.desktopSize === '1536x864'">
                                    <x-label>1536x864</x-label>
                                </x-menuitem>
                                <x-menuitem value="1440x900" :toggled="wbConfig.config.desktopSize === '1440x900'">
                                    <x-label>1440x900</x-label>
                                </x-menuitem>
                                <x-menuitem value="1366x768" :toggled="wbConfig.config.desktopSize === '1366x768'">
                                    <x-label>1366x768</x-label>
                                </x-menuitem>
                                <x-menuitem value="1280x960" :toggled="wbConfig.config.desktopSize === '1280x960'">
                                    <x-label>1280x960</x-label>
                                </x-menuitem>
                                <x-menuitem value="1280x720" :toggled="wbConfig.config.desktopSize === '1280x720'">
                                    <x-label>1280x720</x-label>
                                </x-menuitem>
                                <x-menuitem value="1024x768" :toggled="wbConfig.config.desktopSize === '1024x768'">
                                    <x-label>1024x768</x-label>
                                </x-menuitem>
                                <x-menuitem value="800x600" :toggled="wbConfig.config.desktopSize === '800x600'">
                                    <x-label>800x600</x-label>
                                </x-menuitem>
                            </x-menu>
                        </x-select>
                    </div>
                </x-card>

                <!-- Display Scaling -->
                <ConfigCard
                    class="relative z-10"
                    icon="uil:scaling-right"
                    title="Display Scaling"
                    desc="Controls how large the display scaling is."
                    type="dropdown"
                    unit="%"
                    :options="[Number(100), 140, 180]"
                    v-model:value="wbConfig.config.scale"
                />

                <!-- Application Scaling -->
                <ConfigCard
                    icon="uil:apps"
                    title="Application Scaling"
                    desc="Controls how large the application scaling is.."
                    type="number"
                    :step="10"
                    :min="100"
                    :max="500"
                    v-model:value="wbConfig.config.scaleDesktop"
                />

                <!-- Multi Monitor -->
                <ConfigCard
                    class="relative z-10"
                    icon="uil:monitor"
                    title="Multi-Monitor Support"
                    type="dropdown"
                    :options="Object.values(MultiMonitorMode)"
                    v-model:value="wbConfig.config.multiMonitor"
                >
                    <template v-slot:desc>
                        Controls how multiple monitors are handled. MultiMon creates separate displays for each
                        monitor, while Span stretches the display across all monitors. Note: Span or MultiMon may
                        work better depending on your setup.
                    </template>
                </ConfigCard>

                <!-- Smartcard Passthrough -->
                <ConfigCard
                    icon="game-icons:swipe-card"
                    title="Smartcard Passthrough"
                    desc="If enabled, your smartcard readers will be passed to Windows when you start an app"
                    type="switch"
                    v-model:value="wbConfig.config.smartcardEnabled"
                >
                </ConfigCard>

                <!-- RDP Monitoring -->
                <ConfigCard
                    icon="fluent:remote-16-filled"
                    title="RDP Monitoring"
                    desc="If enabled, a banner will appear when the RDP session is connected (may cause high CPU usage, disable if you notice performance issues)"
                    type="switch"
                    v-model:value="wbConfig.config.rdpMonitoringEnabled"
                />
            </div>
        </div>

        <div>
            <x-label class="mb-4 text-neutral-300">WinBoat</x-label>

            <div class="flex flex-col gap-4">
                <!-- Experimental Features -->
                <ConfigCard
                    icon="streamline-ultimate:lab-tube-experiment"
                    title="Experimental Features"
                    desc="If enabled, you'll have access to experimental features that may not be stable or complete"
                    type="switch"
                    v-model:value="wbConfig.config.experimentalFeatures"
                    @toggle="toggleExperimentalFeatures"
                />

                <!-- Advanced Settings -->
                <ConfigCard
                    icon="mdi:administrator"
                    title="Advanced Settings"
                    desc="If enabled, you'll have access to advanced settings that may prevent WinBoat from working if misconfigured"
                    type="switch"
                    v-model:value="wbConfig.config.advancedFeatures"
                />

                <!-- Disable Animations -->
                <ConfigCard
                    icon="mdi:animation-outline"
                    title="Disable Animations"
                    desc="If enabled, all animations in the UI will be disabled (useful when GPU acceleration isn't working well)"
                    type="switch"
                    v-model:value="wbConfig.config.disableAnimations"
                />
            </div>
        </div>

        <div>
            <x-label class="mb-4 text-neutral-300">Danger Zone</x-label>
            <x-card class="flex flex-col py-3 my-0 mb-6 w-full backdrop-blur-xl backdrop-brightness-150 bg-red-500/10">
                <h1 class="my-0 text-lg font-normal text-red-300">
                    ⚠️ <span class="font-bold">WARNING:</span> All actions here are potentially destructive, proceed at
                    your own caution!
                </h1>
            </x-card>
            <div></div>
            <x-button
                class="!bg-red-800/20 px-4 py-1 !border-red-500/10 generic-hover flex flex-row items-center gap-2 !text-red-300"
                @click="resetWinboat()"
                :disabled="isResettingWinboat"
            >
                <Icon v-if="resetQuestionCounter < 3" icon="mdi:bomb" class="size-8"></Icon>
                <x-throbber v-else class="size-8"></x-throbber>

                <span v-if="resetQuestionCounter === 0">Reset Winboat & Remove VM</span>
                <span v-else-if="resetQuestionCounter === 1">Are you sure? This action cannot be undone.</span>
                <span v-else-if="resetQuestionCounter === 2">One final check, are you ABSOLUTELY sure?</span>
                <span v-else-if="resetQuestionCounter === 3">Resetting Winboat...</span>
            </x-button>
        </div>
    </div>
</template>

<script setup lang="ts">
import ConfigCard from "../components/ConfigCard.vue";
import { computed, onMounted, ref, watch, reactive } from "vue";
import { Winboat } from "../lib/winboat";
import { ContainerRuntimes, ContainerStatus } from "../lib/containers/common";
import type { ComposeConfig } from "../../types";
import { getSpecs } from "../lib/specs";
import { Icon } from "@iconify/vue";
import { MultiMonitorMode, RdpArg, WinboatConfig } from "../lib/config";
import { USBManager, type PTSerializableDeviceInfo } from "../lib/usbmanager";
import { type Device } from "usb";
import {
    USB_VID_BLACKLIST,
    RESTART_UNLESS_STOPPED,
    RESTART_NO,
    GUEST_QMP_PORT,
    MIN_VM_RAM_GB,
    QMP_ARGUMENT,
    QMP_PORT_MAPPING,
    RECOMMENDED_VM_RAM_GB,
} from "../lib/constants";
const { app }: typeof import("@electron/remote") = require("@electron/remote");
const electron: typeof import("electron") = require("electron").remote || require("@electron/remote");
const os: typeof import("os") = require("node:os");

// For Resources
const compose = ref<ComposeConfig | null>(null);
const numCores = ref(0);
const origNumCores = ref(0);
const maxNumCores = ref(0);
const ramGB = ref(0);
const origRamGB = ref(0);
const maxRamGB = ref(0);
const shareFolder = ref(false);
const origShareFolder = ref(false);
const sharedFolderPath = ref("");
const origSharedFolderPath = ref("");
const origAutoStartContainer = ref(false);
const autoStartContainer = ref(false);
const isApplyingChanges = ref(false);
const resetQuestionCounter = ref(0);
const isResettingWinboat = ref(false);
const isUpdatingUSBPrerequisites = ref(false);

// For USB Devices
const availableDevices = ref<Device[]>([]);

// For General
const wbConfig = reactive(WinboatConfig.getInstance());
const winboat = Winboat.getInstance();
const usbManager = USBManager.getInstance();

// Constants
const USB_BUS_PATH = "/dev/bus/usb:/dev/bus/usb";

onMounted(async () => {
    await assignValues();
});

/**
 * Assigns the initial values from the Compose file to the reactive refs
 * so we can display them and track when a change has been made
 */
async function assignValues() {
    compose.value = Winboat.readCompose(winboat.containerMgr!.composeFilePath);

    numCores.value = Number(compose.value.services.windows.environment.CPU_CORES);
    origNumCores.value = numCores.value;

    ramGB.value = Number(compose.value.services.windows.environment.RAM_SIZE.split("G")[0]);
    origRamGB.value = ramGB.value;

    // Find any volume that ends with /shared
    const sharedVolume = compose.value.services.windows.volumes.find(v => v.includes("/shared"));
    if (sharedVolume) {
        shareFolder.value = true;
        // Extract the path before :/shared
        const [hostPath] = sharedVolume.split(":");
        sharedFolderPath.value = hostPath.replace("${HOME}", os.homedir());
    } else {
        shareFolder.value = false;
        sharedFolderPath.value = "";
    }
    origShareFolder.value = shareFolder.value;
    origSharedFolderPath.value = sharedFolderPath.value;

    autoStartContainer.value = compose.value.services.windows.restart === RESTART_UNLESS_STOPPED;
    origAutoStartContainer.value = autoStartContainer.value;

    const specs = await getSpecs();
    maxRamGB.value = specs.ramGB;
    maxNumCores.value = specs.cpuCores;

    refreshAvailableDevices();
}

/**
 * Saves the currently specified values to the Compose file
 * and then re-assigns the initial values to the reactive refs
 */
async function saveCompose() {
    compose.value!.services.windows.environment.RAM_SIZE = `${ramGB.value}G`;
    compose.value!.services.windows.environment.CPU_CORES = `${numCores.value}`;

    // Remove any existing shared volume
    const existingSharedVolume = compose.value!.services.windows.volumes.find(v => v.includes("/shared"));
    if (existingSharedVolume) {
        compose.value!.services.windows.volumes = compose.value!.services.windows.volumes.filter(
            v => !v.includes("/shared"),
        );
    }

    // Add the new shared volume if enabled
    if (shareFolder.value && sharedFolderPath.value) {
        const volumeStr = `${sharedFolderPath.value}:/shared`;
        compose.value!.services.windows.volumes.push(volumeStr);
    }

    compose.value!.services.windows.restart = autoStartContainer.value ? RESTART_UNLESS_STOPPED : RESTART_NO;

    isApplyingChanges.value = true;
    try {
        await winboat.replaceCompose(compose.value!);
        await assignValues();
    } catch (e) {
        console.error("Failed to apply changes");
        console.error(e);
    } finally {
        isApplyingChanges.value = false;
    }
}

/**
 * Opens a dialog to select a folder to share with Windows
 */
function selectSharedFolder() {
    electron.dialog
        .showOpenDialog({
            title: "Select Folder to Share",
            properties: ["openDirectory"],
            defaultPath: sharedFolderPath.value || os.homedir(),
        })
        .then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                sharedFolderPath.value = result.filePaths[0];
            }
        });
}

/**
 * Adds the required fields for USB passthrough to work
 * to the Compose file if they don't already exist
 */
async function addRequiredComposeFieldsUSB() {
    if (!usbPassthroughDisabled.value) {
        return;
    }

    isUpdatingUSBPrerequisites.value = true;
    await winboat.stopContainer();

    if (!hasUsbVolume()) {
        compose.value!.services.windows.volumes.push(USB_BUS_PATH);
    }
    if (!hasQmpPort()) {
        compose.value!.services.windows.ports.push(QMP_PORT_MAPPING);
    }

    if (!compose.value!.services.windows.environment.ARGUMENTS) {
        compose.value!.services.windows.environment.ARGUMENTS = "";
    }
    if (!hasQmpArgument()) {
        compose.value!.services.windows.environment.ARGUMENTS += `\n${QMP_ARGUMENT}`;
    }

    if (!compose.value!.services.windows.environment.HOST_PORTS) {
        compose.value!.services.windows.environment.HOST_PORTS = "";
    }
    if (!hasHostPort()) {
        const delimiter = compose.value!.services.windows.environment.HOST_PORTS.length == 0 ? "" : ",";
        compose.value!.services.windows.environment.HOST_PORTS += delimiter + GUEST_QMP_PORT;
    }

    await saveCompose();

    isUpdatingUSBPrerequisites.value = false;
}

const errors = computed(() => {
    let errCollection: string[] = [];

    if (!numCores.value || numCores.value < 2) {
        errCollection.push("You must allocate at least two CPU cores for Windows to run properly");
    }

    if (numCores.value > maxNumCores.value) {
        errCollection.push("You cannot allocate more CPU cores to Windows than you have available");
    }

    if (!ramGB.value || ramGB.value < MIN_VM_RAM_GB) {
        errCollection.push(`You must allocate at least ${MIN_VM_RAM_GB} GB of RAM for Windows to run properly`);
    }

    if (ramGB.value > maxRamGB.value) {
        errCollection.push("You cannot allocate more RAM to Windows than you have available");
    }

    return errCollection;
});

const warnings = computed(() => {
    if (ramGB.value >= MIN_VM_RAM_GB && ramGB.value < RECOMMENDED_VM_RAM_GB) {
        return [
            `Allocating less than the recommended ${RECOMMENDED_VM_RAM_GB} GB of RAM may limit Windows performance`,
        ];
    }

    return [];
});

const hasUsbVolume = () => compose.value?.services.windows.volumes?.some(x => x.includes(USB_BUS_PATH));
const hasQmpArgument = () => compose.value?.services.windows.environment.ARGUMENTS?.includes(QMP_ARGUMENT);
const hasQmpPort = () =>
    compose.value?.services.windows.ports.some(port => port.endsWith(`:${GUEST_QMP_PORT}`)) ?? false;
const hasHostPort = () => compose.value?.services.windows.environment.HOST_PORTS?.includes(`${GUEST_QMP_PORT}`);

const usbPassthroughDisabled = computed(() => {
    return !hasUsbVolume() || !hasQmpArgument() || !hasQmpPort() || !hasHostPort();
});

const saveButtonDisabled = computed(() => {
    const hasResourceChanges =
        origNumCores.value !== numCores.value ||
        origRamGB.value !== ramGB.value ||
        shareFolder.value !== origShareFolder.value ||
        sharedFolderPath.value !== origSharedFolderPath.value ||
        autoStartContainer.value !== origAutoStartContainer.value;

    const shouldBeDisabled = errors.value?.length || !hasResourceChanges || isApplyingChanges.value;

    return shouldBeDisabled;
});

async function resetWinboat() {
    if (++resetQuestionCounter.value < 3) {
        return;
    }

    isResettingWinboat.value = true;
    await winboat.resetWinboat();
    app.exit();
}

// Reactivity utterly fails here, so we use this function to
// refresh via the button
function refreshAvailableDevices() {
    availableDevices.value = usbManager.devices.value.filter(device => {
        return (
            !usbManager.isDeviceInPassthroughList(device) &&
            !USB_VID_BLACKLIST.some(x => usbManager.stringifyDevice(device).includes(x))
        );
    });
    console.info("[Available Devices] Debug", availableDevices.value);
}

function addDevice(device: Device): void {
    try {
        usbManager.addDeviceToPassthroughList(device);
        refreshAvailableDevices();
    } catch (error) {
        console.error("Failed to add device to passthrough list:", error);
    }
}

function removeDevice(ptDevice: PTSerializableDeviceInfo): void {
    try {
        usbManager.removeDeviceFromPassthroughList(ptDevice);
        refreshAvailableDevices();
    } catch (error) {
        console.error("Failed to remove device from passthrough list:", error);
    }
}

async function toggleExperimentalFeatures() {
    // Remove all passthrough USB devices if we're disabling experimental features
    // since USB passthrough is an experimental feature
    if (!wbConfig.config.experimentalFeatures) {
        await usbManager.removeAllPassthroughDevicesAndConfig();

        // Create the QMP interval if experimental features are enabled
        // This would get created by default since we're changing the compose and re-deploying,
        // but a scenario could also occur where the user is re-enabling experimental features
        // after the compose changes, which then would cause a bug
        // TODO: Remove after USB passthrough is no longer experimental
    } else if (winboat.containerStatus.value == ContainerStatus.RUNNING && !winboat.hasQMPInterval) {
        console.log("Creating QMP interval because experimental features were turned on");
        winboat.createQMPInterval();
    }
}

// Watch for when shared folder is enabled and set default path
watch(shareFolder, (newValue) => {
    if (newValue && !sharedFolderPath.value) {
        sharedFolderPath.value = os.homedir();
    }
});
</script>

<style scoped>
.devices-move,
.devices-enter-active,
.devices-leave-active,
.menu-move,
.menu-enter-active,
.menu-leave-active {
    transition: all 0.5s ease;
}

.devices-enter-from,
.devices-leave-to {
    opacity: 0;
    transform: translateX(30px);
}

.devices-leave-active,
.menu-leave-active {
    position: absolute;
}

.menu-enter-from,
.menu-leave-to {
    opacity: 0;
    transform: translateX(20px) scale(0.9);
}
</style>

<template>
    <main 
        class="overflow-hidden relative w-screen h-screen"
        :class="{ animationsDisabled: 'disable-animations' }"
    >
        <!-- Decoration -->
        <div
            class="gradient-ball absolute -z-10 left-0 bottom-0 translate-x-[-50%] translate-y-[50%] w-[90vw] aspect-square opacity-15"
        ></div>
        <div
            class="gradient-ball absolute -z-10 right-0 top-0 translate-x-[50%] translate-y-[-50%] w-[90vw] aspect-square opacity-15"
            style="filter: hue-rotate(45deg) blur(200px)"
        ></div>

        <!-- Stripes for experimental -->
        <div
            v-show="wbConfig?.config.experimentalFeatures"
            class="experimental-stripes absolute top-0 left-0 w-full h-[3rem] pointer-events-none z-[10] opacity-15 grayscale"
        ></div>

        <!-- Titlebar -->
        <x-titlebar
            @minimize="handleMinimize()"
            @buttonclick="handleTitleBarEvent"
            class="backdrop-blur-xl bg-neutral-900/50"
        >
            <x-label>WinBoat</x-label>
        </x-titlebar>

        <!-- Updater -->
        <dialog ref="updateDialog">
            <Icon
                v-if="winboat?.guestServerUpdateError.value"
                class="text-red-400 size-12"
                icon="clarity:warning-solid"
            ></Icon>
            <Icon v-else class="text-indigo-400 size-12" icon="mdi:cloud-upload"></Icon>
            <template v-if="manualUpdateRequired">
                <h3 class="mt-2">Manual Guest Server Update Required</h3>
                <div class="max-w-[60vw]">
                    <strong
                        >WinBoat has encountered an issue while trying to update the Guest Server automatically. Please
                        follow the steps below to manually update it:</strong
                    >
                    <p v-if="winboat?.guestServerUpdateError.value" class="text-sm text-red-400/90 break-words">
                        {{ winboat.guestServerUpdateError.value }}
                    </p>
                    <ol class="mt-2 list-decimal list-inside">
                        <li>
                            Use VNC over at
                            <a @click="openAnchorLink" :href="NOVNC_URL" target="_blank" rel="noopener noreferrer">
                                {{ NOVNC_URL }}
                            </a>
                            to access Windows
                        </li>
                        <li>Press Win + R or search for <code>Run</code>, type in <code>services.msc</code></li>
                        <li>Stop the <code>WinBoatGuestServer</code> service by right clicking and pressing "Stop"</li>
                        <li>
                            Download the new Guest Server from
                            <a
                                @click="openAnchorLink"
                                href="https://github.com/TibixDev/winboat/releases"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                https://github.com/TibixDev/winboat/releases
                            </a>
                            , you should pick version <strong>{{ appVer }}</strong>
                        </li>
                        <li>Navigate to <code>C:\Program Files\WinBoat\server</code> and delete the contents</li>
                        <li>Extract the freshly downloaded zip into the same folder</li>
                        <li>
                            Start the <code>WinBoatGuestServer</code> service by right clicking and pressing "Start"
                        </li>
                        <li>If you were using VNC, log out of Windows and close it</li>
                        <li>Restart WinBoat</li>
                    </ol>
                    <p>We're sorry for the inconvenience. 😟</p>
                </div>
            </template>

            <template v-else-if="winboat?.isUpdatingGuestServer.value">
                <h3 class="mt-2">Updating Guest Server</h3>
                <p class="max-w-[40vw]">
                    The guest is currently running an outdated version of the WinBoat Guest Server. Please wait while we
                    update it to the current version.
                </p>
            </template>

            <template v-else>
                <h3 class="mt-2">Guest Server update successful!</h3>
                <p class="max-w-[40vw]">
                    The WinBoat Guest Server has been updated successfully! You can now close this dialog and continue
                    using the application.
                </p>
            </template>
            <footer v-if="!manualUpdateRequired">
                <x-progressbar v-if="winboat?.isUpdatingGuestServer.value" class="my-4"></x-progressbar>
                <x-button v-else id="close-button" @click="updateDialog!.close()" toggled>
                    <x-label>Close</x-label>
                </x-button>
            </footer>
        </dialog>

        <!-- UI / SetupUI -->
        <div
            v-if="!['SetupUI', 'Migration'].includes($route.name?.toString() || '')"
            class="flex flex-row h-[calc(100vh-2rem)]"
        >
            <x-nav class="flex flex-col flex-none gap-0.5 w-72 backdrop-blur-xl bg-gray-500/10 backdrop-contrast-90">
                <div
                    v-if="winboat?.rdpConnected.value"
                    class="w-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-blue-500 text-white !mt-0 py-1 shadow-md shadow-indigo-500/50 transition-all duration-300 hover:brightness-105 flex flex-row items-center justify-center gap-2"
                >
                    <Icon class="size-5" icon="mdi:remote-desktop"></Icon>
                    <span class="font-semibold text-center"> RDP Session Active </span>
                </div>
                <div class="flex flex-row gap-4 items-center p-4">
                    <img
                        class="w-16 rounded-full"
                        src="/img/pfp.svg"
                        alt="Profile"
                    />
                    <div>
                        <x-label class="text-lg font-semibold">{{ os.userInfo().username }}</x-label>
                        <x-label class="text-[0.8rem]">Local Account</x-label>
                    </div>
                </div>
                <RouterLink
                    v-for="route of routes.filter(
                        (r: RouteRecordRaw) => !['SetupUI', 'Loading', 'Migration'].includes(String(r.name)),
                    )"
                    :to="route.path"
                    :key="route.path"
                >
                    <x-navitem>
                        <Icon class="mr-4 w-5 h-5" :icon="(route.meta!.icon as string)" />
                        <x-label>{{ route.name }}</x-label>
                    </x-navitem>
                </RouterLink>
                <div class="flex flex-col justify-end items-center p-4 h-full">
                    <p class="text-xs text-neutral-500">WinBoat Beta v{{ appVer }} {{ isDev ? "Dev" : "Prod" }}</p>
                </div>
            </x-nav>
            <div class="px-5 flex-grow max-h-[calc(100vh-2rem)] overflow-y-auto py-4">
                <div class="flex flex-row gap-2 items-center my-6">
                    <Icon class="w-6 h-6 opacity-60" icon="icon-park-solid:toolkit"></Icon>
                    <h1 class="my-0 text-2xl font-semibold opacity-60">WinBoat</h1>
                    <Icon class="w-6 h-6" icon="bitcoin-icons:caret-right-filled"></Icon>
                    <Icon class="w-6 h-6" :icon="useRoute().meta.icon as string"></Icon>
                    <h1 class="my-0 text-2xl font-semibold">
                        {{ useRoute().name }}
                    </h1>
                </div>
                <router-view v-slot="{ Component }">
                    <transition mode="out-in" name="fade">
                        <component :is="Component" />
                    </transition>
                </router-view>
            </div>
        </div>

        <div v-else class="w-full h-[calc(100vh-2rem)]">
            <RouterView />
        </div>
    </main>
</template>

<script setup lang="ts">
import { RouteRecordRaw, RouterLink, useRoute, useRouter } from "vue-router";
import { routes } from "./router";
import { Icon } from "@iconify/vue";
import { onMounted, ref, useTemplateRef, watch, reactive, computed } from "vue";
import { isInstalled } from "./lib/install";
import { Winboat } from "./lib/winboat";
import { openAnchorLink } from "./utils/openLink";
import { WinboatConfig } from "./lib/config";
import { USBManager } from "./lib/usbmanager";
import { NOVNC_URL } from "./lib/constants";
import { performAutoMigrations } from "./lib/migrate";
const { BrowserWindow }: typeof import("@electron/remote") = require("@electron/remote");
const os: typeof import("os") = require("node:os");

const $router = useRouter();
const $route = useRoute();
const appVer = import.meta.env.VITE_APP_VERSION;
const isDev = import.meta.env.DEV;
let winboat: Winboat | null;
let wbConfig: WinboatConfig | null;

let updateTimeout: NodeJS.Timeout | null = null;
const manualUpdateRequired = ref(false);
const MANUAL_UPDATE_TIMEOUT = 60000; // 60 seconds
const updateDialog = useTemplateRef("updateDialog");

const animationsDisabled = computed(() => wbConfig?.config.disableAnimations);

onMounted(async () => {
    const winboatInstalled = await isInstalled();

    if (winboatInstalled) {
        wbConfig = reactive(WinboatConfig.getInstance()); // Instantiate singleton class
        winboat = Winboat.getInstance(); // Instantiate singleton class
        USBManager.getInstance(); // Instantiate singleton class

        // Migrations
        $router.push("/migration");
        await performAutoMigrations();

        // After migrations, go to home
        $router.push("/home");
    } else {
        console.log("Not installed, redirecting to setup...");
        $router.push("/setup");
    }

    // Watch for guest server updates and show dialog
    watch(
        () => winboat?.isUpdatingGuestServer.value,
        isUpdating => {
            if (isUpdating === true) {
                updateDialog.value!.showModal();
                // Prepare the timeout to show manual update required after 45 seconds
                updateTimeout = setTimeout(() => {
                    manualUpdateRequired.value = true;
                }, MANUAL_UPDATE_TIMEOUT);
            } else {
                // Clear the timeout if the update finished before the timeout
                if (updateTimeout) {
                    clearTimeout(updateTimeout);
                    updateTimeout = null;
                }
                // A failed update still needs the manual steps. Clearing this on
                // failure used to replace them with a success message.
                manualUpdateRequired.value = Boolean(winboat?.guestServerUpdateError.value);
            }
        },
    );
});

function handleMinimize() {
    console.log("Minimize");
    window.electronAPI.minimizeWindow();
}

function handleTitleBarEvent(e: CustomEvent) {
    console.log("TitleBarEvt", e);
    switch (e.detail) {
        case "close":
            BrowserWindow.getFocusedWindow()!.close();
            break;
        case "maximize":
            if (BrowserWindow.getFocusedWindow()!.isMaximized()) {
                BrowserWindow.getFocusedWindow()!.unmaximize();
            } else {
                BrowserWindow.getFocusedWindow()!.maximize();
            }
            break;
        case "minimize":
            BrowserWindow.getFocusedWindow()!.minimize();
            break;
    }
}
</script>

<style>
dialog::backdrop {
    pointer-events: none;
    backdrop-filter: blur(8px);
}

.gradient-ball {
    border-radius: 99999px;
    background:
        linear-gradient(197.37deg, #7450db -0.38%, rgba(138, 234, 240, 0) 101.89%),
        linear-gradient(115.93deg, #3e88f6 4.86%, rgba(62, 180, 246, 0.33) 38.05%, rgba(62, 235, 246, 0) 74.14%),
        radial-gradient(
            56.47% 76.87% at 6.92% 7.55%,
            rgba(62, 136, 246, 0.7) 0%,
            rgba(62, 158, 246, 0.182) 52.16%,
            rgba(62, 246, 246, 0) 100%
        ),
        linear-gradient(306.53deg, #2ee4e3 19.83%, rgba(46, 228, 227, 0) 97.33%);
    background-blend-mode: normal, normal, normal, normal, normal, normal;
    filter: blur(200px);
}

.fade-enter-active,
.fade-leave-active {
    transition: all 0.2s ease;
}

.fade-enter-from {
    opacity: 0;
}

.fade-leave-to {
    opacity: 0;
}

/* Stripes for the top of the window to indicate experimental features enabled */
.experimental-stripes {
    background: repeating-linear-gradient(
        45deg,
        #ffffff00,
        #ffffff00 25px,
        rgb(129 140 248) 25px,
        rgb(129 140 248) 50px
    );
    -webkit-mask-image: -webkit-gradient(linear, left 0%, left bottom, from(rgba(0, 0, 0, 1)), to(rgba(0, 0, 0, 0)));
}

/* Disable all animations when the setting is enabled */
body.disable-animations,
body.disable-animations *,
body.disable-animations *::before,
body.disable-animations *::after {
    animation: none !important;
    transition: none !important;
}

/* Specifically disable Vue transition components */
body.disable-animations .fade-enter-active,
body.disable-animations .fade-leave-active,
body.disable-animations .devices-move,
body.disable-animations .devices-enter-active,
body.disable-animations .devices-leave-active,
body.disable-animations .menu-move,
body.disable-animations .menu-enter-active,
body.disable-animations .menu-leave-active,
body.disable-animations .apps-move,
body.disable-animations .apps-enter-active,
body.disable-animations .apps-leave-active,
body.disable-animations .bounce-enter-active,
body.disable-animations .bounce-leave-active,
body.disable-animations .bouncedown-enter-active,
body.disable-animations .bouncedown-leave-active,
body.disable-animations .bounce-in,
body.disable-animations .bouncedown-in {
    transition: none !important;
    animation: none !important;
}
</style>

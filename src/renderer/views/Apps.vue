<template>
    <div>
        <dialog ref="addCustomAppDialog">
            <h3 class="mb-2">{{ currentAppForm.Source === "custom" ? "Edit App" : "Add App" }}</h3>
            <div class="flex flex-row gap-5 mt-4 w-[35vw]">
                <div class="flex flex-col flex-none gap-2 justify-center items-center">
                    <div class="relative">
                        <img
                            alt="Icon for current app"
                            v-if="currentAppForm.Icon"
                            :src="currentAppForm.Icon"
                            class="size-24"
                        />
                        <Icon v-else class="size-24 text-neutral-400" icon="mdi:image"></Icon>
                        <button
                            @click="pickCustomAppIcon"
                            class="flex absolute top-0 left-0 flex-col gap-1 justify-center items-center w-full h-full rounded-xl opacity-0 backdrop-blur-sm transition duration-200 absoute bg-black/50 hover:opacity-100"
                        >
                            <Icon icon="mdi:pencil" class="size-10"></Icon>
                            <x-label>Change Icon</x-label>
                        </button>
                    </div>
                </div>
                <div class="flex flex-col gap-0.5 justify-center w-full">
                    <!-- Name field -->
                    <x-label>Name</x-label>
                    <x-input
                        v-model="currentAppForm.Name"
                        class="!max-w-full"
                        @input="(e: any) => (customAppName = e.target.value)"
                        type="text"
                    />

                    <!-- Path field -->
                    <x-label class="mt-4">Path</x-label>
                    <x-input
                        v-model="currentAppForm.Path"
                        type="text"
                        class="!max-w-full"
                        @input="(e: any) => (customAppPath = e.target.value)"
                    />

                    <!-- Arguments field -->
                    <x-label class="mt-2">Arguments</x-label>
                    <x-input v-model="currentAppForm.Args" type="text" class="!max-w-full" placeholder="Optional" />
                </div>
            </div>

            <div class="flex flex-col gap-1 mt-2">
                <div class="flex flex-row gap-2 items-center my-0 font-semibold text-blue-400">
                    <Icon icon="fluent:info-32-filled" class="inline size-4"></Icon>
                    <p class="!my-0 break-normal max-w-[30vw]">
                        Please make sure the path you enter is a valid path to an executable file, otherwise the app
                        will not work.
                    </p>
                </div>
                <div class="flex flex-row gap-2 items-center my-0 font-semibold text-blue-400">
                    <Icon icon="fluent:info-32-filled" class="inline size-4"></Icon>
                    <p class="!my-0 break-normal max-w-[30vw]">
                        Custom apps can be removed by right clicking on them and selecting "Remove Custom App".
                    </p>
                </div>
                <div
                    class="flex flex-row gap-2 items-center my-0 font-semibold text-red-500"
                    v-for="(error, k) of customAppAddErrors"
                    :key="k"
                >
                    <Icon icon="fluent:warning-32-filled" class="inline size-4"></Icon>
                    <p class="!my-0">{{ error }}</p>
                </div>
            </div>

            <template>
                <div class="apps-grid">
                    <div
                        v-for="app in apps"
                        :key="app.id"
                        class="app-tile"
                        @contextmenu.prevent="openContextMenu($event, app)"
                    >
                        {{ app.Name }}
                    </div>
                </div>
            </template>
            <footer>
                <x-button @click="cancelAddCustomApp" id="cancel-button">
                    <x-label>Cancel</x-label>
                </x-button>
                <x-button
                    toggled
                    id="add-button"
                    :disabled="customAppAddErrors.length > 0 || (orginalAppForm?.Source === 'custom' && isSame)"
                    @click="saveApp"
                >
                    <x-label>{{ currentAppForm.Source === "custom" ? "Save" : "Create New" }}</x-label>
                </x-button>
            </footer>
        </dialog>

        <div
            class="flex justify-between items-center mb-6"
            :class="{
                'opacity-50 pointer-events-none':
                    winboat.containerStatus.value !== ContainerStatus.RUNNING || !winboat.isOnline.value,
            }"
        >
            <x-label class="text-neutral-300">Apps</x-label>
            <div class="flex flex-row gap-2 justify-center items-center">
                <!-- Refresh button -->
                <x-button class="flex flex-row gap-1 items-center" @click="refreshApps">
                    <Icon icon="mdi:refresh" class="size-4"></Icon>
                    <x-label>Refresh</x-label>
                </x-button>

                <!-- Custom App Add Button -->
                <x-button class="flex flex-row gap-1 items-center" @click="openAddAppDialog()">
                    <x-icon href="#add" class="qualifier"></x-icon>
                    <x-label class="qualifier">Add Custom</x-label>
                </x-button>
                <x-select
                    @change="
                        (e: any) => {
                            sortBy = e.detail.newValue;
                            WinboatConfig.getInstance().config.appsSortOrder = e.detail.newValue;
                        }
                    "
                    :disabled="!winboat.isOnline.value"
                >
                    <x-menu class="">
                        <x-menuitem value="name" :toggled="sortBy === 'name'">
                            <x-icon href="#sort" class="qualifier"></x-icon>
                            <x-label>
                                <span class="qualifier"> Sort By: </span>
                                Name
                            </x-label>
                        </x-menuitem>
                        <x-menuitem value="usage" :toggled="sortBy === 'usage'">
                            <x-icon href="#sort" class="qualifier"></x-icon>
                            <x-label>
                                <span class="qualifier"> Sort By: </span>
                                Usage
                            </x-label>
                        </x-menuitem>
                    </x-menu>
                </x-select>
                <x-select
                    @change="(e: any) => (filterBy = e.detail.newValue)"
                    :disabled="!winboat.isOnline.value"
                    class="flex flex-row-reverse gap-1 items-center justify-center"
                >
                    <Icon icon="mdi:filter-outline" style="width: 17; height: 17"></Icon>
                    <x-menu class="">
                        <x-menuitem value="all" toggled>
                            <x-label>
                                <span class="qualifier"> Filter: </span>
                                All
                            </x-label>
                        </x-menuitem>

                        <x-menuitem v-for="(label, value) in AllSources" :value="value">
                            <x-label>
                                <span class="qualifier"> Filter: </span>
                                {{ label }}
                            </x-label>
                        </x-menuitem>
                    </x-menu>
                </x-select>

                <!-- Search Input -->
                <x-input
                    id="search-term"
                    class="m-0 w-64 max-w-64"
                    type="text"
                    maxlength="32"
                    :value="searchInput"
                    @input="(e: any) => (searchInput = e.target.value)"
                    :disabled="!winboat.isOnline.value"
                >
                    <x-icon href="#search"></x-icon>
                    <x-label>Search</x-label>
                </x-input>
            </div>
        </div>
        <div v-if="winboat.isOnline.value" class="px-2">
            <TransitionGroup
                v-if="apps.length"
                name="apps"
                tag="x-card"
                class="grid gap-4 bg-transparent border-none app-grid"
            >
                <x-card
                    v-for="app of computedApps"
                    :key="app.id"
                    class="flex relative flex-row gap-2 justify-between items-center p-2 my-0 backdrop-blur-xl backdrop-brightness-150 cursor-pointer generic-hover bg-neutral-800/20"
                    :class="{
                        'bg-gradient-to-r from-yellow-600/20 bg-neutral-800/20': app.Source === 'custom',
                        'app-launching': launchingAppId === app.id,
                    }"
                    @click="handleLaunchApp(app)"
                    @contextmenu="openContextMenu($event, app)"
                >
                    <div class="flex flex-row items-center gap-2 w-[85%]">
                        <img
                            class="rounded-md size-10"
                            :src="`data:image/png;charset=utf-8;base64,${app.Icon}`"
                            alt="App Icon"
                        />
                        <x-label class="truncate text-ellipsis">{{ app.Name }}</x-label>
                    </div>
                    <Icon icon="cuida:caret-right-outline"></Icon>
                </x-card>
            </TransitionGroup>
            <div v-else class="flex justify-center items-center mt-40">
                <x-throbber class="w-16 h-16"></x-throbber>
            </div>
            <WBContextMenu key="contextMenu" ref="contextMenuRef" @hide="onContextMenuHide">
                <WBMenuItem @click="launchApp">
                    <Icon class="size-4" icon="mdi:play-circle-outline"></Icon>
                    <x-label>Launch</x-label>
                </WBMenuItem>

                <WBMenuItem @click="contextMenuTarget && openEditAppDialog(contextMenuTarget)">
                    <Icon class="size-4" icon="mdi:pencil-outline"></Icon>
                    <x-label>Edit</x-label>
                </WBMenuItem>

                <WBMenuItem v-if="contextMenuTarget?.Source === 'custom'" @click="removeCustomApp">
                    <Icon class="size-4" icon="mdi:trash-can-outline"></Icon>
                    <x-label>Remove</x-label>
                </WBMenuItem>
            </WBContextMenu>
        </div>
        <div v-else class="px-2 mt-32">
            <div class="flex flex-col gap-4 justify-center items-center">
                <Icon class="text-violet-400 size-32" icon="fluent-mdl2:plug-disconnected"></Icon>
                <h1 class="text-xl font-semibold w-[30vw] text-center leading-16">
                    <span
                        v-if="
                            winboat.containerStatus.value === ContainerStatus.EXITED ||
                            winboat.containerStatus.value === ContainerStatus.UNKNOWN
                        "
                    >
                        The WinBoat Container is not running, please start it to view your apps list.
                    </span>
                    <span v-else>
                        The WinBoat Guest API is not running, please restart the container. If this problem persists,
                        contact customer support.
                    </span>
                </h1>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch, type WatchHandle } from "vue";
import { Winboat } from "../lib/winboat";
import { ContainerStatus } from "../lib/containers/common";
import { type WinApp } from "../../types";
import WBContextMenu from "../components/WBContextMenu.vue";
import WBMenuItem from "../components/WBMenuItem.vue";
import { AppIcons, DEFAULT_ICON } from "../data/appicons";
import { debounce } from "../utils/debounce";
import { Jimp, JimpMime } from "jimp";
import { WinboatConfig } from "../lib/config";
import { WINBOAT_API_URL } from "../lib/constants";
const nodeFetch: typeof import("node-fetch").default = require("node-fetch");
const FormData: typeof import("form-data") = require("form-data");

const winboat = Winboat.getInstance();
const apps = ref<WinApp[]>([]);
const searchInput = ref("");
const sortBy = ref("");
const filterBy = ref("all");
const addCustomAppDialog = useTemplateRef("addCustomAppDialog");
const customAppName = ref("");
const customAppPath = ref("");
const customAppIcon = ref(`data:image/png;base64,${AppIcons[DEFAULT_ICON]}`);
const customAppArgs = ref("");
const orginalAppForm = ref<WinApp | null>(null);
const currentAppForm = ref<WinApp>({
    Name: "",
    Path: "",
    Args: "",
    Icon: "",
    Source: "",
});
// Created after an await in onMounted, so Vue won't stop these automatically.
let stopOnlineWatch: WatchHandle | null = null;
let stopCustomAppPathWatch: WatchHandle | null = null;
let unmounted = false;

const hideContextMenu = () => contextMenuRef.value?.hide();

const AllSources = computed(() => {
    let sourceList: Record<string, string> = {};
    const sourceMap: Record<string, string> = {
        system: "System",
        winreg: "Windows Registry",
        startmenu: "Start Menu",
        uwp: "Microsoft Store",
        internal: "Internal",
    };

    for (const app of apps.value) {
        sourceList[app.Source] = sourceMap[app.Source] || app.Source;
    }

    return sourceList;
});

const computedApps = computed(() => {
    // Make copy, otherwise UI might glitch, creating "ghost" app
    let appsCache = [...apps.value];

    if (filterBy.value !== "all") {
        appsCache = appsCache.filter(app => app.Source === filterBy.value);
    }

    if (searchInput.value) {
        appsCache = appsCache.filter(app => app.Name.toLowerCase().includes(searchInput.value.toLowerCase()));
    }

    if (sortBy.value === "usage") {
        appsCache.sort((a, b) => (b.Usage ?? 0) - (a.Usage ?? 0));
    } else {
        appsCache.sort((a, b) => a.Name.localeCompare(b.Name));
    }

    return appsCache;
});

onMounted(async () => {
    sortBy.value = WinboatConfig.getInstance().config.appsSortOrder;

    await refreshApps();

    if (unmounted) return;

    stopOnlineWatch = watch(winboat.isOnline, async newVal => {
        if (newVal) {
            await refreshApps();
            console.log("Apps list: ", apps.value);
        }
    });

    // Fetch icon for custom app path
    stopCustomAppPathWatch = watch(customAppPath, async (newVal, oldVal) => {
        await debouncedFetchIcon(newVal, oldVal);
    });

    window.addEventListener("scroll", hideContextMenu, true);
    window.addEventListener("resize", hideContextMenu);
});

onUnmounted(() => {
    unmounted = true;
    stopOnlineWatch?.();
    stopCustomAppPathWatch?.();
    window.removeEventListener("scroll", hideContextMenu, true);
    window.removeEventListener("resize", hideContextMenu);
});

async function refreshApps() {
    if (winboat.isOnline.value) {
        const loadedApps = await winboat.appMgr!.getApps();
        apps.value = loadedApps.map(app => ({
            ...app,
            id: crypto.randomUUID(),
        }));
        // Run in background, won't impact UX
        await winboat.appMgr!.updateAppCache();
    }
}

const debouncedFetchIcon = debounce(async (newVal: string, oldVal: string) => {
    if (newVal !== oldVal && newVal !== "") {
        const formData = new FormData();
        formData.append("path", newVal);
        const iconRes = await nodeFetch(`${WINBOAT_API_URL}/get-icon`, {
            method: "POST",
            body: formData as any,
        });
        const icon = await iconRes.text();
        customAppIcon.value = `data:image/png;base64,${icon}`;
        console.log(`Custom app icon fetched for ${newVal}:`, customAppIcon.value);
    }
}, 500);

const isSame = computed(() => {
    const orig = orginalAppForm.value;
    const curr = currentAppForm.value;

    return orig ? orig.Name === curr.Name && orig.Path === curr.Path && (orig.Args || "") === (curr.Args || "") : false;
});

const customAppAddErrors = computed(() => {
    const errors: string[] = [];

    if (!customAppName.value) {
        errors.push("A valid name is required for your app");
    }

    if (apps.value.some(app => app.Name === customAppName.value) && orginalAppForm.value) {
        if (orginalAppForm.value.Name !== customAppName.value || orginalAppForm.value.Source !== "custom") {
            errors.push("An app with this name already exists");
        }
    }

    if (!customAppPath.value) {
        errors.push("A valid path is required for your app");
    }

    if (!customAppIcon.value) {
        errors.push("A valid icon is required for your app");
    }

    return errors;
});

const launchingAppId = ref<string | null>(null);

function handleLaunchApp(app: WinApp) {
    launchingAppId.value = app.id!;
    winboat.launchApp(app);
    setTimeout(() => {
        launchingAppId.value = null;
    }, 1200);
}

const contextMenuRef = ref();
const contextMenuTarget = ref<WinApp | null>(null);

async function openContextMenu(event: MouseEvent, app: WinApp) {
    contextMenuTarget.value = app;
    await nextTick(); // Wait for DOM to update
    contextMenuRef.value?.show(event); // Let WBContextMenu handle positioning
}

function openAddAppDialog() {
    orginalAppForm.value = null;
    const app = {
        Name: "",
        Path: "",
        Args: "",
        Icon: customAppIcon.value,
        Source: "",
        Usage: 0,
    };
    currentAppForm.value = app;
    contextMenuTarget.value = null;
    addCustomAppDialog.value?.showModal();
}

function openEditAppDialog(app: WinApp) {
    orginalAppForm.value = { ...app };
    customAppName.value = app.Name;
    customAppPath.value = app.Path;
    customAppIcon.value = app.Icon;
    customAppArgs.value = app.Args;
    contextMenuTarget.value = app;
    currentAppForm.value = {
        Name: app.Name,
        Path: app.Path,
        Args: app.Args || "",
        Icon: `data:image/png;base64,${app.Icon}`,
        Source: app.Source,
        Usage: app.Usage,
    };
    addCustomAppDialog.value?.showModal();
}

async function saveApp() {
    const iconRaw = currentAppForm.value.Icon.split("data:image/png;base64,")[1];

    if (currentAppForm.value.Source === "custom" && orginalAppForm.value) {
        await winboat.appMgr!.updateCustomApp(orginalAppForm.value.Name, {
            Name: currentAppForm.value.Name,
            Path: currentAppForm.value.Path,
            Args: currentAppForm.value.Args,
            Icon: iconRaw,
        });
        console.log("Save");
    } else {
        await winboat.appMgr!.addCustomApp(
            currentAppForm.value.Name,
            currentAppForm.value.Path,
            currentAppForm.value.Args,
            iconRaw,
        );
        console.log("New save");
    }

    refreshApps();
    cancelAddCustomApp();
}

function onContextMenuHide() {
    contextMenuTarget.value = null;
}

function launchApp() {
    if (contextMenuTarget.value) {
        winboat.launchApp(contextMenuTarget.value);
    }
}

/**
 * Triggers the file picker for the custom app icon, then processes the image selected
 */
function pickCustomAppIcon() {
    const filePicker = document.createElement("input");
    filePicker.type = "file";
    filePicker.accept = "image/*";
    filePicker.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement)?.files?.[0];
        if (!file) {
            console.log("No file selected");
            return;
        }

        try {
            const buf = await file.arrayBuffer();

            const image = await Jimp.read(Buffer.from(buf));
            image.resize({ w: 128, h: 128 });
            const pngBuffer = await image.getBuffer(JimpMime.png);
            customAppIcon.value = `data:image/png;base64,${pngBuffer.toString("base64")}`;
        } catch (error) {
            console.error("Image processing failed:", error);
        }
    };
    filePicker.click();
}

/**
 * Cancels the add custom app dialog and resets the form
 */
function cancelAddCustomApp() {
    addCustomAppDialog.value!.close();
    resetCustomAppForm();
}

/**
 * Removes a custom app from WinBoat's application list
 */
async function removeCustomApp() {
    if (!contextMenuTarget.value) return;
    await winboat.appMgr!.removeCustomApp(contextMenuTarget.value);
    await refreshApps();
}

async function resetCustomAppForm() {
    // So there is no visual flicker while the dialog is closing
    setTimeout(() => {
        customAppName.value = "";
        customAppPath.value = "";
        customAppIcon.value = `data:image/png;base64,${AppIcons[DEFAULT_ICON]}`;
        customAppArgs.value = "";

        // Because of course Vue reactivity fails here :(
        addCustomAppDialog.value?.querySelectorAll<HTMLInputElement>("x-input")?.forEach(input => {
            input.value = "";
        });
    }, 100);
}
</script>

<style scoped>
.app-grid {
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
}

x-menu .qualifier {
    display: none;
}

@keyframes launch-pulse {
    0% {
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(167, 138, 249, 0);
    }
    10% {
        transform: scale(0.97);
    }
    30% {
        transform: scale(1);
        box-shadow: 0 0 14px 3px rgba(167, 138, 249, 0.4);
    }
    65% {
        box-shadow: 0 0 20px 5px rgba(167, 138, 249, 0.15);
    }
    100% {
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(167, 138, 249, 0);
    }
}

.app-launching {
    animation: launch-pulse 1.2s ease-out;
}

.apps-move, /* apply transition to moving elements */
.apps-enter-active,
.apps-leave-active {
    transition: all 0.5s ease;
}

.apps-enter-from,
.apps-leave-to {
    opacity: 0;
    transform: translateX(30px);
}

/* ensure leaving items are taken out of layout flow so that moving
   animations can be calculated correctly. */
.apps-leave-active {
    position: absolute;
}
</style>

<template>
    <main class="h-screen flex flex-col bg-neutral-900">
        <x-titlebar @buttonclick="titlebarAction" class="bg-neutral-950/50"><x-label>WinBoat</x-label></x-titlebar>
        <div class="p-6 flex-1 min-h-0 overflow-auto flex flex-col">
            <LaunchPanel v-if="state" :state="state" shortcut />
        </div>
        <x-progressbar
            v-if="!state || state.kind === 'starting' || state.kind === 'launched'"
            class="w-full h-1 flex-none"
            role="progressbar"
            aria-label="Opening application"
        ></x-progressbar>
    </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { LaunchState } from "../../types";
import { performWindowAction } from "../lib/electron";
const { ipcRenderer }: typeof import("electron") = require("electron");
import LaunchPanel from "../components/LaunchPanel.vue";

const state = ref<LaunchState | null>(null);
const onState = (_event: Electron.IpcRendererEvent, value: LaunchState | null) => {
    state.value = value;
};
ipcRenderer.on("shortcut:state", onState);
onMounted(async () => {
    state.value = await ipcRenderer.invoke("shortcut:state");
});
onUnmounted(() => ipcRenderer.removeListener("shortcut:state", onState));
function titlebarAction(event: CustomEvent) {
    if (event.detail === "close" || event.detail === "minimize") performWindowAction(event.detail);
}
</script>

<style scoped>
x-titlebar::part(maximize-button),
x-titlebar::part(restore-button) {
    display: none;
}
</style>

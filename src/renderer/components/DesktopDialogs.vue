<template>
    <dialog ref="failureDialog" class="w-[560px] max-w-[90vw]" @close="desktopFailure = null">
        <LaunchPanel v-if="desktopFailure" :state="desktopFailure" @dismiss="desktopFailure = null" />
    </dialog>
    <dialog ref="logsDialog" class="w-[760px] max-w-[90vw]" @close="logsOpen = false">
        <h3>WinBoat logs</h3>
        <LogsPanel v-if="logsOpen" />
        <footer>
            <x-button @click="logsOpen = false"><x-label>Close</x-label></x-button>
        </footer>
    </dialog>
</template>

<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import { desktopFailure, logsOpen } from "../lib/shortcuts";
import LaunchPanel from "./LaunchPanel.vue";
import LogsPanel from "./LogsPanel.vue";

const failureDialog = useTemplateRef("failureDialog");
const logsDialog = useTemplateRef("logsDialog");
watch(desktopFailure, async value => {
    await nextTick();
    if (value && !failureDialog.value?.open) failureDialog.value?.showModal();
    else if (!value) failureDialog.value?.close();
});
watch(logsOpen, async value => {
    await nextTick();
    if (value && !logsDialog.value?.open) logsDialog.value?.showModal();
    else if (!value) logsDialog.value?.close();
});
</script>

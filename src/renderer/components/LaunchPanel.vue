<template>
    <div class="flex flex-col gap-4 w-full" :class="{ 'flex-1': shortcut }">
        <template v-if="showLogs">
            <h3 class="!m-0">WinBoat logs</h3>
            <LogsPanel />
            <footer :class="{ 'mt-auto pt-2': shortcut }">
                <x-button @click="showLogs = false"><x-label>Back</x-label></x-button>
            </footer>
        </template>
        <template v-else>
            <div class="flex items-center gap-4">
                <img
                    v-if="state.icon"
                    :src="iconUrl(state.icon)"
                    class="size-16 object-contain"
                    alt="Application icon"
                />
                <img v-else src="/img/winboat_logo.png" class="size-14 object-contain flex-none" alt="WinBoat" />
                <h3 class="!m-0 break-words">{{ state.name }}</h3>
            </div>
            <p class="!m-0 text-neutral-200">{{ state.message }}</p>
            <p v-if="state.detail" class="!m-0 text-sm text-neutral-400 max-h-24 overflow-auto break-words select-text">
                {{ state.detail }}
            </p>
            <x-progressbar v-if="!shortcut && state.kind === 'starting'"></x-progressbar>
            <label v-if="state.kind === 'confirm'" class="flex items-center gap-2 text-sm text-neutral-300">
                <input v-model="alwaysStart" type="checkbox" class="accent-violet-400" />
                Always start Windows automatically for shortcuts
            </label>
            <footer
                v-if="state.kind !== 'launched'"
                class="flex gap-2 flex-wrap justify-end pt-2"
                :class="{ 'mt-auto': shortcut }"
            >
                <template v-if="isError">
                    <x-button @click="showLogs = true"><x-label>Open logs</x-label></x-button>
                    <x-button v-if="state.kind === 'guest-error'" @click="openExternal(GS_TROUBLESHOOTING_URL)"
                        ><x-label>Troubleshooting guide</x-label></x-button
                    >
                    <x-button v-if="shortcut" @click="sendAction('quit')"><x-label>Quit WinBoat</x-label></x-button>
                    <x-button v-else @click="$emit('dismiss')"><x-label>Close</x-label></x-button>
                </template>
                <template v-else>
                    <x-button @click="sendAction('cancel')"><x-label>Cancel</x-label></x-button>
                    <x-button
                        v-if="state.kind === 'confirm'"
                        toggled
                        @click="sendAction(alwaysStart ? 'always-start' : 'start')"
                        ><x-label>Start Windows</x-label></x-button
                    >
                    <x-button v-if="state.kind === 'missing'" toggled @click="sendAction('remove')"
                        ><x-label>Remove shortcut</x-label></x-button
                    >
                </template>
            </footer>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { LaunchAction, LaunchState } from "../../types";
import { openExternal } from "../lib/electron";
const { ipcRenderer }: typeof import("electron") = require("electron");
const sendAction = (action: LaunchAction) => ipcRenderer.send("shortcut:action", action);
import { GS_TROUBLESHOOTING_URL } from "../lib/constants";
import LogsPanel from "./LogsPanel.vue";

const props = defineProps<{ state: LaunchState; shortcut?: boolean }>();
defineEmits<{ dismiss: [] }>();
const showLogs = ref(false);
const alwaysStart = ref(false);
const isError = computed(() => ["error", "guest-error", "container-error"].includes(props.state.kind));
const iconUrl = (icon: string) => (icon.startsWith("data:") ? icon : `data:image/png;base64,${icon}`);
watch(
    () => props.state.kind,
    () => {
        showLogs.value = false;
    },
);
</script>

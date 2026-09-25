<template>
    <x-card class="flex flex-col gap-3 py-3 my-0 w-full backdrop-blur-xl backdrop-brightness-150 bg-red-500/10">
        <!-- Error: the app stays open, the user decides what to do next -->
        <div v-if="failedStep" class="flex flex-col gap-3">
            <div class="flex flex-row items-center gap-3">
                <Icon icon="line-md:alert" class="size-10 shrink-0 text-red-500"></Icon>
                <div class="flex flex-col gap-1">
                    <h1 class="my-0 text-lg font-semibold text-red-300">Removal failed at "{{ failedStep }}"</h1>
                    <p class="my-0 text-sm text-gray-200">{{ errorMessage }}</p>
                </div>
            </div>
            <p class="my-0 text-sm text-gray-300">
                {{ REMOVAL_STEP_DESCRIPTIONS[RemovalStates.REMOVAL_ERROR] }}
            </p>
            <p class="my-0 text-sm text-gray-400">
                You can retry the failed step, inspect the removal log, or close this view to keep using WinBoat.
            </p>
            <div class="flex flex-row gap-2">
                <x-button
                    :disabled="isRunning"
                    class="!bg-red-800/20 px-4 py-1 !border-red-500/10 generic-hover flex flex-row items-center gap-2 !text-red-300"
                    @click="retry()"
                >
                    <x-throbber v-if="isRunning" class="size-6"></x-throbber>
                    <Icon v-else icon="mdi:refresh" class="size-6"></Icon>
                    <span>Retry</span>
                </x-button>
                <x-button
                    class="!bg-red-800/20 px-4 py-1 !border-red-500/10 generic-hover flex flex-row items-center gap-2 !text-red-300"
                    @click="openLogFolder()"
                >
                    <Icon icon="mdi:folder-open-outline" class="size-6"></Icon>
                    <span>Open log folder</span>
                </x-button>
                <x-button
                    class="!bg-red-800/20 px-4 py-1 !border-red-500/10 generic-hover flex flex-row items-center gap-2 !text-red-300"
                    @click="emit('close')"
                >
                    <span>Close</span>
                </x-button>
            </div>
        </div>

        <!-- Completed: what got removed, and what was skipped (if anything) -->
        <div v-else-if="summary" class="flex flex-col gap-3">
            <div class="flex flex-row items-center gap-3">
                <Icon icon="line-md:confirm-circle" class="size-10 shrink-0 text-green-500"></Icon>
                <div class="flex flex-col gap-1">
                    <h1 class="my-0 text-lg font-semibold text-green-300">Removal completed</h1>
                    <p class="my-0 text-sm text-gray-300">{{ REMOVAL_STEP_DESCRIPTIONS[RemovalStates.COMPLETED] }}</p>
                </div>
            </div>
            <div class="flex flex-col gap-1">
                <span class="text-sm font-semibold text-gray-300">Removed:</span>
                <div v-for="item of summary.removed" :key="item" class="flex flex-row items-center gap-2">
                    <Icon icon="mdi:check" class="size-5 shrink-0 text-green-500"></Icon>
                    <span class="text-sm text-gray-200">{{ item }}</span>
                </div>
            </div>
            <div v-if="summary.warnings.length > 0" class="flex flex-col gap-1">
                <span class="text-sm font-semibold text-gray-300">Skipped:</span>
                <div v-for="warning of summary.warnings" :key="warning" class="flex flex-row items-start gap-2">
                    <Icon icon="clarity:warning-solid" class="size-5 shrink-0 text-yellow-500"></Icon>
                    <span class="text-sm text-yellow-200">{{ warning }}</span>
                </div>
            </div>
        </div>

        <!-- In progress: step list, weighted progress bar and the current step's what & why -->
        <div v-else class="flex flex-col gap-3">
            <div class="flex flex-row items-center justify-between gap-2">
                <h1 class="my-0 text-lg font-semibold text-red-200">Removing WinBoat</h1>
                <span class="text-sm text-gray-400">Step {{ currentStepIndex + 1 }} of {{ totalSteps }}</span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-700">
                <div
                    class="h-full rounded-full bg-red-500 transition-all duration-500"
                    :style="{ width: `${progress}%` }"
                ></div>
            </div>
            <p class="my-0 text-sm text-gray-300">{{ currentStepDescription }}</p>
            <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                <li v-for="(step, index) of REMOVAL_STEP_ORDER" :key="step" class="flex flex-row items-center gap-2">
                    <Icon v-if="stepStatus(index) === 'done'" icon="mdi:check" class="size-5 shrink-0 text-green-500">
                    </Icon>
                    <x-throbber v-else-if="stepStatus(index) === 'current'" class="size-5"></x-throbber>
                    <span v-else class="inline-block size-5 shrink-0"></span>
                    <span class="text-sm" :class="stepStatus(index) === 'pending' ? 'text-gray-500' : 'text-gray-200'">
                        {{ step }}
                    </span>
                </li>
            </ul>
        </div>

        <!-- Live log, shared by every state of the flow -->
        <details class="rounded-lg bg-neutral-900/50 px-3 py-2">
            <summary class="cursor-pointer select-none text-sm text-gray-400 transition hover:text-gray-200">
                Show details
            </summary>
            <div
                v-auto-scroll
                class="mt-2 h-48 overflow-y-auto rounded-md bg-neutral-900/70 p-2 font-mono text-xs leading-5 text-gray-300"
            >
                <div v-for="(line, index) of logLines" :key="index" class="whitespace-pre-wrap break-words">
                    {{ line }}
                </div>
                <div v-if="logLines.length === 0" class="text-gray-500">No output yet...</div>
            </div>
        </details>
    </x-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Icon } from "@iconify/vue";
import {
    REMOVAL_STEP_DESCRIPTIONS,
    REMOVAL_STEP_ORDER,
    RemovalManager,
    RemovalStates,
    removalProgress,
    type RemovalSummary,
} from "../lib/removal";

const { shell }: typeof import("@electron/remote") = require("@electron/remote");

const props = defineProps<{ manager: RemovalManager }>();
const emit = defineEmits<{ close: [] }>();

const totalSteps = REMOVAL_STEP_ORDER.length;
const currentStep = ref<RemovalStates>(props.manager.state);
// Initialize from the manager so a mid-run reattach shows the real progress;
// COMPLETED/REMOVAL_ERROR are not executable steps, so clamp their -1 index to 0
const currentStepIndex = ref(Math.max(0, REMOVAL_STEP_ORDER.indexOf(props.manager.state)));
const logLines = ref<string[]>([]);
const failedStep = ref<RemovalStates | null>(null);
const errorMessage = ref("");
const summary = ref<RemovalSummary | null>(null);
const isRunning = ref(false);

/** Completed-work semantics: the bar reaches 100% only once the flow has completed */
const progress = computed(() => (summary.value ? 100 : removalProgress(currentStep.value)));

const currentStepDescription = computed(() => REMOVAL_STEP_DESCRIPTIONS[currentStep.value]);

type StepStatus = "done" | "current" | "pending";

function stepStatus(index: number): StepStatus {
    if (index < currentStepIndex.value) return "done";
    if (index === currentStepIndex.value) return "current";
    return "pending";
}

let unbindEvents: (() => void)[] = [];

function subscribe() {
    unbindEvents = [
        props.manager.emitter.on("stepChanged", (state, index) => {
            currentStep.value = state;
            currentStepIndex.value = index;
        }),
        props.manager.emitter.on("log", line => logLines.value.push(line)),
        props.manager.emitter.on("error", (state, error) => {
            failedStep.value = state;
            errorMessage.value = error.message;
        }),
        props.manager.emitter.on("completed", removalSummary => {
            summary.value = removalSummary;
        }),
    ];
}

function unsubscribe() {
    unbindEvents.forEach(unbind => unbind());
    unbindEvents = [];
}

async function runRemoval(fromStep?: RemovalStates) {
    // The view may mount while the flow is already executing headless (navigating
    // away and back reattaches the same manager); just observe its events then.
    if (props.manager.running) return;

    isRunning.value = true;
    try {
        await props.manager.run({ fromStep });
    } finally {
        isRunning.value = false;
    }
}

onMounted(() => {
    // Subscribe before running so no stepChanged/log event is missed
    subscribe();
    runRemoval();
});

onBeforeUnmount(unsubscribe);

async function retry() {
    const fromStep = failedStep.value;

    if (!fromStep || isRunning.value) return;

    // Fresh subscription for the new attempt, then resume at the step that failed
    unsubscribe();
    failedStep.value = null;
    errorMessage.value = "";
    subscribe();

    await runRemoval(fromStep);
}

function openLogFolder() {
    // removal.log lives directly in the WinBoat data directory
    void shell.openPath(props.manager.deps.winboatDir);
}
</script>

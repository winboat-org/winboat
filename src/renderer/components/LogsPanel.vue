<template>
    <div class="w-full min-w-0">
        <div class="flex gap-2 items-center mb-3">
            <x-button
                v-for="tab in tabs"
                :key="tab.value"
                :toggled="selected === tab.value"
                @click="selected = tab.value"
            >
                <x-label>{{ tab.label }}</x-label>
            </x-button>
            <x-button class="ml-auto" :disabled="loading" @click="refresh"><x-label>Refresh</x-label></x-button>
        </div>
        <pre class="bg-black/30 rounded-lg p-3 overflow-auto h-52 text-xs whitespace-pre-wrap break-all select-text">{{
            loading ? "Loading logs…" : error || logs?.[selected] || "No logs yet."
        }}</pre>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { readLogTail } from "../utils/log";
import { CONTAINER_LOG_FILE, WINBOAT_LOG_FILE, FREERDP_LOG_FILE } from "../lib/constants";
import { WinboatConfig } from "../lib/config";
import { createContainer } from "../lib/containers/common";
import { execFileAsync } from "../lib/exec-helper";

type Logs = { container: string; winboat: string; freerdp: string };

const tabs = [
    { value: "container", label: "Container logs" },
    { value: "winboat", label: "WinBoat logs" },
    { value: "freerdp", label: "FreeRDP logs" },
] as const;
const selected = ref<keyof Logs>("container");
const logs = ref<Logs | null>(null);
const loading = ref(false);
const error = ref("");

async function refresh() {
    loading.value = true;
    error.value = "";
    try {
        const config = WinboatConfig.readConfigObject(false);
        let runtimeLogs = "";
        if (config) {
            const container = createContainer(config.containerRuntime);
            try {
                const { stdout, stderr } = await execFileAsync(
                    container.executableAlias,
                    ["logs", "--tail", "200", container.containerName],
                    { timeout: 5000, maxBuffer: 1024 * 1024 },
                );
                runtimeLogs = stdout + stderr;
            } catch (error) {
                const result = error as Error & { stdout?: string; stderr?: string };
                runtimeLogs = [result.stdout, result.stderr, result.message].filter(Boolean).join("\n");
            }
        }
        logs.value = {
            container: [runtimeLogs, readLogTail(CONTAINER_LOG_FILE)].filter(Boolean).join("\n\n"),
            winboat: readLogTail(WINBOAT_LOG_FILE),
            freerdp: readLogTail(FREERDP_LOG_FILE),
        };
    } catch (e) {
        error.value = `Could not read logs: ${e}`;
    } finally {
        loading.value = false;
    }
}
onMounted(refresh);
</script>

<template>
    <div>
        <x-card
            class="bg-neutral-800/20 backdrop-brightness-150 backdrop-blur-xl flex flex-row items-center justify-between"
        >
            <div class="flex flex-row gap-4 items-center">
                <div class="border-[0.4rem] border-gray-900/30 rounded-md">
                    <img class="h-32 rounded-sm" :src="wallpaper" alt="Windows Wallpaper" />
                </div>

                <!-- Status Text -->
                <div>
                    <div class="flex flex-row gap-2 items-center justify-center mb-6 *:m-0">
                        <h1 class="text-3xl">
                            {{ WINDOWS_VERSIONS[compose?.services.windows.environment.VERSION ?? "11"] ?? "Unknown" }}
                        </h1>
                        <p class="bg-purple-500 px-4 rounded-full text-lg font-semibold !m-0">
                            {{ capitalizeFirstLetter(winboat.containerMgr!.executableAlias) }}
                        </p>
                    </div>

                    <div
                        class="flex flex-row items-center gap-1.5 mb-1"
                        :class="{ 'text-green-500': winboat.isOnline.value, 'text-red-500': !winboat.isOnline.value }"
                    >
                        <Icon class="size-7" icon="material-symbols:api"></Icon>
                        <p class="!my-0 font-semibold text-lg">
                            WinBoat Guest API -
                            {{ winboat.isOnline.value ? "Online" : "Offline" }}
                            <a
                                v-if="!winboat.isOnline.value"
                                title="Get Help"
                                href="https://rentry.org/winboat_guest_server_borked"
                                @click="openAnchorLink"
                                class="text-red-400 hover:text-red-500 hover:underline inline-flex translate-y-1 transition"
                            >
                                <Icon icon="mingcute:question-fill" class="size-6 pointer-events-none"></Icon>
                            </a>
                        </p>
                    </div>

                    <div
                        class="flex flex-row items-center gap-1.5"
                        :class="{
                            'text-red-500':
                                winboat.containerStatus.value === ContainerStatus.EXITED ||
                                winboat.containerStatus.value === ContainerStatus.ERROR,
                            'text-green-500': winboat.containerStatus.value === ContainerStatus.RUNNING,
                            'text-yellow-500': winboat.containerStatus.value === ContainerStatus.PAUSED,
                            'text-orange-500': winboat.containerStatus.value === ContainerStatus.UNKNOWN,
                            'text-gray-500': winboat.containerStatus.value === ContainerStatus.CREATED,
                        }"
                    >
                        <Icon class="size-7 scale-90" icon="octicon:container-16"></Icon>
                        <p class="!my-0 font-semibold text-lg">
                            Container -
                            {{
                                winboat.containerStatus.value === ContainerStatus.ERROR
                                    ? "Failed to Start"
                                    : capitalizeFirstLetter(winboat.containerStatus.value)
                            }}
                            <button
                                v-if="winboat.containerStatus.value === ContainerStatus.ERROR"
                                @click="openContainerLogFile()"
                                class="text-sm"
                            >
                                (check logs
                                <Icon icon="lucide:external-link" class="inline size-3.5 ml-0.5 translate-y-[-1px]" />
                                )
                            </button>
                        </p>
                    </div>

                    <!-- The actual reason the last container action failed -->
                    <div
                        v-if="winboat.containerError.value"
                        class="flex flex-row items-start gap-1.5 mt-1 text-red-400/90"
                    >
                        <Icon class="size-5 flex-none translate-y-0.5" icon="clarity:warning-solid"></Icon>
                        <p class="!my-0 text-sm max-w-[36rem] break-words">{{ winboat.containerError.value }}</p>
                    </div>

                    <!-- Shown when a broken container was repaired automatically -->
                    <div
                        v-if="winboat.containerRecovered.value"
                        class="flex flex-row items-start gap-1.5 mt-1 text-amber-400/90"
                    >
                        <Icon class="size-5 flex-none translate-y-0.5" icon="mdi:refresh"></Icon>
                        <p class="!my-0 text-sm max-w-[36rem] break-words">
                            The container was stale and has been recreated from your compose file. Your Windows disk
                            was not touched.
                        </p>
                    </div>
                </div>
            </div>

            <!-- Buttons -->
            <div v-if="!winboat.containerActionLoading.value" class="flex flex-row items-center gap-5 text-gray-200/80">
                <button
                    title="Start"
                    class="generic-hover"
                    v-if="
                        winboat.containerStatus.value === ContainerStatus.EXITED ||
                        winboat.containerStatus.value === ContainerStatus.CREATED ||
                        winboat.containerStatus.value === ContainerStatus.UNKNOWN ||
                        winboat.containerStatus.value === ContainerStatus.ERROR
                    "
                    @click="runContainerAction(() => winboat.startContainer())"
                >
                    <Icon class="w-20 h-20 text-green-300" icon="mingcute:play-fill"></Icon>
                </button>
                <button
                    title="Stop"
                    class="generic-hover"
                    v-if="winboat.containerStatus.value === ContainerStatus.RUNNING"
                    @click="winboat.stopContainer()"
                >
                    <Icon class="w-20 h-20 text-red-300" icon="mingcute:stop-fill"></Icon>
                </button>
                <button
                    title="Restart"
                    class="generic-hover"
                    v-if="winboat.containerStatus.value === ContainerStatus.RUNNING"
                    @click="runContainerAction(() => winboat.restartContainer())"
                >
                    <Icon class="w-20 h-20 text-orange-300" icon="mingcute:refresh-3-line"></Icon>
                </button>

                <button
                    title="Pause / Unpause"
                    class="generic-hover"
                    v-if="
                        winboat.containerStatus.value === ContainerStatus.RUNNING ||
                        winboat.containerStatus.value === ContainerStatus.PAUSED
                    "
                    @click="
                        winboat.containerStatus.value === ContainerStatus.PAUSED
                            ? winboat.unpauseContainer()
                            : winboat.pauseContainer()
                    "
                >
                    <Icon class="w-20 h-20 text-yellow-100" icon="mingcute:pause-line"></Icon>
                </button>
            </div>

            <div v-else>
                <x-throbber class="w-16 h-16"></x-throbber>
            </div>
        </x-card>

        <!-- Metrics -->
        <div
            class="grid grid-cols-3 w-full gap-8 transition-all duration-200"
            :class="{ 'blur-sm opacity-50': !winboat.isOnline.value }"
        >
            <x-card class="bg-neutral-800/20 backdrop-brightness-150 backdrop-blur-xl flex flex-row gap-2 pl-0 my-0">
                <apexchart
                    class="translate-y-2"
                    type="radialBar"
                    :options="chartOptions"
                    :series="[winboat.metrics.value.cpu.usage]"
                    :width="120"
                    :height="120"
                />
                <div>
                    <div class="flex flex-row gap-2 items-center mb-2">
                        <Icon class="size-8 text-violet-400" icon="solar:cpu-bold"></Icon>
                        <h2 class="my-0 text-2xl">CPU</h2>
                    </div>
                    <p class="!my-0 text-gray-400 h-6 overflow-hidden">
                        {{ compose?.services.windows.environment.CPU_CORES }} Virtual Cores
                    </p>
                    <p class="!my-0 text-gray-400 h-6 overflow-hidden">
                        Frequency: {{ (winboat.metrics.value.cpu.frequency / 1000).toFixed(2) }} GHz
                    </p>
                </div>
            </x-card>
            <x-card class="bg-neutral-800/20 backdrop-brightness-150 backdrop-blur-xl flex flex-row gap-2 pl-0 my-0">
                <apexchart
                    class="translate-y-2"
                    type="radialBar"
                    :options="chartOptions"
                    :series="[winboat.metrics.value.ram.percentage]"
                    :width="120"
                    :height="120"
                />
                <div>
                    <div class="flex flex-row gap-2 items-center mb-2">
                        <Icon class="size-8 text-violet-400" icon="game-icons:ram"></Icon>
                        <h2 class="my-0 text-2xl">RAM</h2>
                    </div>
                    <p class="!my-0 text-gray-400 h-6 overflow-hidden">
                        {{ Math.round(winboat.metrics.value.ram.total / 1024).toFixed(2) }} GB Total RAM
                    </p>
                    <p class="!my-0 text-gray-400 h-6 overflow-hidden">
                        {{ (winboat.metrics.value.ram.used / 1024).toFixed(2) }} GB Used RAM
                    </p>
                </div>
            </x-card>
            <x-card class="bg-neutral-800/20 backdrop-brightness-150 backdrop-blur-xl flex flex-row gap-2 pl-0 my-0">
                <apexchart
                    class="translate-y-2"
                    type="radialBar"
                    :options="chartOptions"
                    :series="[winboat.metrics.value.disk.percentage]"
                    :width="120"
                    :height="120"
                />
                <div>
                    <div class="flex flex-row gap-2 items-center mb-2">
                        <Icon class="size-8 text-violet-400" icon="carbon:vmdk-disk"></Icon>
                        <h2 class="my-0 text-2xl">Disk</h2>
                    </div>
                    <p class="!my-0 text-gray-400 h-6 overflow-hidden">
                        {{ (winboat.metrics.value.disk.total / 1024).toFixed(2) }} GB Total Disk Space
                    </p>
                    <p class="!my-0 text-gray-400 h-6 overflow-hidden">
                        {{ (winboat.metrics.value.disk.used / 1024).toFixed(2) }} GB Used Space
                    </p>
                </div>
            </x-card>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Winboat } from "../lib/winboat";
import { ContainerStatus } from "../lib/containers/common";
import { type ComposeConfig } from "../../types";
import { WINDOWS_VERSIONS } from "../lib/constants";
import { Icon } from "@iconify/vue";
import { capitalizeFirstLetter } from "../utils/capitalize";
import { openAnchorLink, openContainerLogFile } from "../utils/openLink";

const winboat = Winboat.getInstance();

// Container actions rethrow; the reason is surfaced via winboat.containerError
async function runContainerAction(action: () => Promise<void>) {
    try {
        await action();
    } catch {
        /* surfaced via winboat.containerError */
    }
}
const compose = ref<ComposeConfig | null>(null);
const wallpaper = ref("");

onMounted(async () => {
    compose.value = Winboat.readCompose(winboat.containerMgr!.composeFilePath);
    wallpaper.value = compose.value?.services.windows.environment.VERSION.includes("11")
        ? "./img/wallpaper/win11.webp"
        : "./img/wallpaper/win10.webp";

    // Highlight the navitem for the home page, since by default no
    // navitem is highlighted and we can't use `toggled`
    document.querySelector<HTMLButtonElement>("x-navitem")?.click();
});

const chartOptions = ref({
    chart: {
        type: "radialBar",
        offsetY: -20,
        sparkline: {
            enabled: true,
        },
        width: 100,
        height: 100,
    },
    plotOptions: {
        radialBar: {
            startAngle: -135,
            endAngle: 135,
            track: {
                background: "#18181b", // Unfilled section color
                strokeWidth: "97%",
                margin: 5,
                // dropShadow: {
                //     enabled: true,
                //     top: 2,
                //     left: 0,
                //     color: '#444',
                //     opacity: 1,
                //     blur: 2
                // }
            },
            dataLabels: {
                name: {
                    show: false,
                },
                value: {
                    offsetY: 2,
                    fontSize: "12px",
                    color: "#FFFFFF",
                    formatter: function (val: number) {
                        return val.toFixed(1) + "%"; // Fixed to 1 decimal place
                    },
                },
            },
        },
    },
    grid: {
        padding: {
            top: -10,
        },
    },
    fill: {
        type: "solid", // Switched from gradient to solid
        colors: ["#A78AF9"], // Nice purple for the filled section
    },
    labels: ["Average Results"],
});
</script>

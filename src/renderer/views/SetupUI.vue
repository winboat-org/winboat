<template>
    <div class="relative size-full p-16 overflow-hidden">
        <div class="size-full rounded-3xl bg-[#1F1F1F] shadow-lg shadow-black/50 gap-4 p-5 grid grid-cols-2">
            <div>
                <div id="stepStatus" class="flex flex-row justify-center gap-4 pt-2">
                    <div
                        v-for="(_, idx) of steps"
                        :key="idx"
                        class="w-4 h-4 rounded-full bg-neutral-700 transition duration-1000"
                        :class="{
                            'bg-neutral-500': idx < currentStepIdx,
                            'bg-violet-400': idx === currentStepIdx,
                            'bg-neutral-700': idx > currentStepIdx,
                        }"
                    ></div>
                </div>
                <Transition name="bounce" mode="out-in">
                    <div :key="currentStepIdx" id="stepIcon" class="flex items-center justify-center relative h-full">
                        <Icon key="icon1" class="size-[60%] text-violet-400 z-30 relative" :icon="currentStep.icon" />
                        <Icon
                            key="icon-gradient"
                            class="size-[60%] text-violet-400 brightness-75 z-20 absolute top-[50%] translate-y-[-50%] blur-2xl"
                            :icon="currentStep.icon"
                        />
                        <Icon
                            key="icon2"
                            class="size-[60%] text-violet-400 brightness-75 z-20 absolute top-[51.5%] translate-y-[-50%] translate-x-[1.5%]"
                            :icon="currentStep.icon"
                        />
                        <Icon
                            key="icon3"
                            class="size-[60%] text-violet-400 brightness-50 z-10 absolute top-[53%] translate-y-[-50%] translate-x-[3%]"
                            :icon="currentStep.icon"
                        />
                    </div>
                </Transition>
            </div>

            <Transition name="bouncedown" mode="out-in">
                <div :key="currentStepIdx" id="stepContent" class="overflow-scroll">
                    <!-- Welcome -->
                    <div v-if="currentStep.id === StepID.WELCOME" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            WinBoat is a full-fledged app that helps you natively run Windows applications on your Linux
                            machine with ease.
                        </p>
                        <p class="text-lg text-gray-400">
                            We will go through a few required steps to get you started in no time.
                        </p>
                        <div class="flex flex-row gap-4">
                            <x-button toggled class="px-6" @click="currentStepIdx++">Next</x-button>
                        </div>
                    </div>

                    <!-- License -->
                    <div v-if="currentStep.id === StepID.LICENSE" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            WinBoat is open-source software licensed under the MIT License. Please review the license
                            agreement below.
                        </p>
                        <pre class="text-sm text-gray-400 bg-neutral-800 p-4 rounded-lg overflow-auto">
                            {{ license }}
                        </pre>
                        <div class="flex flex-row gap-4">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button toggled class="px-6" @click="currentStepIdx++">I Agree</x-button>
                        </div>
                    </div>

                    <!-- Pre-Requisites -->
                    <div v-if="currentStep.id === StepID.PREREQUISITES" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            In order to run WinBoat, your computer must meet the following requirements.
                        </p>
                        <ul class="text-lg text-gray-400 list-none space-y-1.5 bg-neutral-800 py-3 rounded-lg">
                            <li class="flex items-center gap-2">
                                <span v-if="specs.ramGB >= MIN_HOST_RAM_GB" class="text-green-500">✔</span>
                                <span v-else class="text-red-500">✘</span>
                                At least {{ MIN_HOST_RAM_GB }} GB of RAM (Detected: {{ specs.ramGB }} GB)
                            </li>

                            <li class="flex items-center gap-2">
                                <span v-if="specs.cpuCores >= 2" class="text-green-500">✔</span>
                                <span v-else class="text-red-500">✘</span>
                                At least 2 CPU cores (Detected: {{ specs.cpuCores }} cores)
                            </li>

                            <li class="flex items-center gap-2">
                                <span v-if="specs.kvmEnabled" class="text-green-500">✔</span>
                                <span v-else class="text-red-500">✘</span>
                                Virtualization (KVM) enabled
                                <a
                                    href="https://duckduckgo.com/?t=h_&q=how+to+enable+virtualization+in+%3Cmotherboard+brand%3E+bios&ia=web"
                                    @click="openAnchorLink"
                                    target="_blank"
                                    class="text-violet-400 hover:underline ml-1"
                                >
                                    How?
                                </a>
                            </li>

                            <li class="flex items-center gap-2">
                                <span v-if="containerInstalled(containerSpecs)" class="text-green-500">✔</span>
                                <span v-else class="text-red-500">✘</span>

                                <div>
                                    <x-select @change="handleContainerRuntimeChange" class="w-fit">
                                        <x-menu>
                                            <x-menuitem
                                                v-for="(runtime, key) in Object.values(ContainerRuntimes)"
                                                :key="key"
                                                :value="runtime"
                                                :toggled="runtime === containerRuntime"
                                            >
                                                <x-label>{{ runtime }}</x-label>
                                            </x-menuitem>
                                        </x-menu>
                                    </x-select>
                                </div>
                                installed
                                <a
                                    :href="containerRuntime === ContainerRuntimes.PODMAN
                                        ? 'https://podman.io/getting-started/installation'
                                        : 'https://docs.docker.com/engine/install/'"
                                    @click="openAnchorLink"
                                    target="_blank"
                                    class="text-violet-400 hover:underline ml-1"
                                >How?</a>
                            </li>

                            <!-- Docker Specific Requirements -->
                            <template v-if="containerRuntime == ContainerRuntimes.DOCKER">
                                <li class="flex items-center gap-2">
                                    <span
                                        v-if="
                                            containerSpecs &&
                                            'dockerComposeInstalled' in containerSpecs &&
                                            containerSpecs.dockerComposeInstalled
                                        "
                                        class="text-green-500"
                                        >✔</span
                                    >
                                    <span v-else class="text-red-500">✘</span>
                                    Docker Compose v2 installed
                                    <a
                                        href="https://docs.docker.com/compose/install/#plugin-linux-only"
                                        @click="openAnchorLink"
                                        target="_blank"
                                        class="text-violet-400 hover:underline ml-1"
                                        >How?</a
                                    >
                                </li>

                                <li class="flex items-center gap-2">
                                    <span
                                        v-if="
                                            containerSpecs &&
                                            'dockerIsInUserGroups' in containerSpecs &&
                                            containerSpecs.dockerIsInUserGroups
                                        "
                                        class="text-green-500"
                                        >✔</span
                                    >
                                    <span v-else class="text-red-500">✘</span>
                                    User added to the
                                    <span class="font-mono bg-neutral-700 rounded-md px-0.5">docker</span> group
                                    <span class="text-gray-600"> (Relog required) </span>
                                    <a
                                        href="https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user"
                                        @click="openAnchorLink"
                                        target="_blank"
                                        class="text-violet-400 hover:underline ml-1"
                                        >How?</a
                                    >
                                </li>

                                <li class="flex items-center gap-2">
                                    <span
                                        v-if="
                                            containerSpecs &&
                                            'dockerIsRunning' in containerSpecs &&
                                            containerSpecs.dockerIsRunning
                                        "
                                        class="text-green-500"
                                        >✔</span
                                    >
                                    <span v-else class="text-red-500">✘</span>
                                    Docker daemon is running
                                    <span class="text-gray-600"> (Also enable on boot) </span>
                                    <a
                                        href="https://docs.docker.com/config/daemon/start/"
                                        @click="openAnchorLink"
                                        target="_blank"
                                        class="text-violet-400 hover:underline ml-1"
                                        >How?</a
                                    >
                                </li>
                            </template>

                            <!-- Podman Specific Requirements -->
                            <template v-else>
                                <li class="flex items-center gap-2">
                                    <span
                                        v-if="
                                            containerSpecs &&
                                            'podmanComposeInstalled' in containerSpecs &&
                                            containerSpecs.podmanComposeInstalled
                                        "
                                        class="text-green-500"
                                        >✔</span
                                    >
                                    <span v-else class="text-red-500">✘</span>
                                    Podman Compose installed
                                    <a
                                        href="https://github.com/containers/podman-compose?tab=readme-ov-file#installation"
                                        @click="openAnchorLink"
                                        target="_blank"
                                        class="text-violet-400 hover:underline ml-1"
                                        >How?</a
                                    >
                                </li>
                            </template>
                            <li class="flex items-center gap-2">
                                <span v-if="specs.freeRDP3Installed" class="text-green-500">✔</span>
                                <span v-else class="text-red-500">✘</span>
                                FreeRDP 3.x.x installed
                                <a
                                    href="https://github.com/FreeRDP/FreeRDP/wiki/PreBuilds"
                                    @click="openAnchorLink"
                                    target="_blank"
                                    class="text-violet-400 hover:underline ml-1"
                                >
                                    How?
                                </a>
                            </li>
                        </ul>
                        <div class="flex items-center gap-2 text-xs text-neutral-500">
                            <Icon
                                icon="mdi:refresh"
                                class="size-3.5"
                                :class="{ 'animate-spin': checkingPrerequisites }"
                            />
                            <span>Next check</span>
                            <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-neutral-700">
                                <div
                                    :key="prerequisiteRefreshSequence"
                                    class="prerequisite-refresh-progress size-full bg-violet-400/60"
                                ></div>
                            </div>
                        </div>
                        <div class="flex flex-row gap-4 mt-6">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button
                                toggled
                                class="px-6"
                                @click="continueFromPrerequisites"
                                :disabled="!satisfiesPrequisites(specs, containerSpecs)"
                            >
                                Next
                            </x-button>
                        </div>
                    </div>

                    <!-- Install Location -->
                    <div v-if="currentStep.id === StepID.INSTALL_LOCATION" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            Choose where you want to install WinBoat. Files related to the Windows virtual machine will
                            be stored in this location.
                        </p>
                        <p class="text-lg text-gray-400">
                            Make sure you have at least {{ MIN_DISK_GB }}GB of disk space available in the selected
                            location.
                        </p>

                        <div class="flex flex-row items-center mt-4">
                            <x-input
                                id="install-location"
                                type="text"
                                placeholder="Select Install Location"
                                readonly
                                :value="installFolder"
                                class="!max-w-full w-[300px] rounded-r-none"
                            >
                                <x-icon href="#folder"></x-icon>
                                <x-label>/your/install/folder</x-label>
                            </x-input>
                            <x-button class="!rounded-l-none" toggled @click="selectInstallFolder">
                                {{ installFolder ? "Change" : "Select" }}
                            </x-button>
                        </div>

                        <div id="install-folder-errors" class="h-[4rem] text-red-400 text-sm font-semibold space-y-1">
                            <div v-for="error in installFolderErrors" :key="error">
                                <Icon icon="line-md:alert" class="inline size-4 -translate-y-0.5"></Icon>
                                {{ error }}
                            </div>
                            <div
                                v-if="installFolder && !installFolderErrors?.length"
                                class="text-green-400 font-semibold"
                            >
                                <Icon icon="line-md:check-all" class="inline size-4 -translate-y-0.5"></Icon>
                                Valid install folder
                            </div>
                        </div>

                        <div class="flex flex-row gap-4 mt-6">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button
                                toggled
                                class="px-6"
                                :disabled="!installFolder || installFolderErrors?.length"
                                @click="currentStepIdx++"
                            >
                                Next
                            </x-button>
                        </div>
                    </div>

                    <!-- Windows Configuration -->
                    <div v-if="currentStep.id === StepID.WINDOWS_CONFIG" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            Pick the version of Windows you want to install, and the language you'd like to use.
                        </p>
                        <p class="text-lg text-gray-400">
                            You can only change these settings now. Once the installation is complete, you will not be
                            able to change them unless you reinstall.
                        </p>
                        <div>
                            <label for="select-edition" class="text-sm mb-4 text-neutral-400">Select Edition</label>
                            <x-select
                                id="select-edition"
                                @change="(e: any) => (windowsVersion = e.detail.newValue)"
                                class="w-64"
                                :disabled="!!customIsoPath"
                            >
                                <x-menu>
                                    <x-menuitem
                                        v-for="(version, key) in WINDOWS_VERSIONS"
                                        :key="key"
                                        :value="key"
                                        :toggled="windowsVersion === key"
                                        v-show="key !== 'custom'"
                                    >
                                        <x-label>{{ version }}</x-label>
                                    </x-menuitem>
                                </x-menu>
                            </x-select>
                        </div>
                        <div>
                            <label for="select-language" class="text-sm mb-4 text-neutral-400">Select Language</label>
                            <x-select
                                id="select-language"
                                @change="(e: any) => (windowsLanguage = e.detail.newValue)"
                                class="w-64"
                                :disabled="!!customIsoPath"
                            >
                                <x-menu @change="(e: any) => (windowsLanguage = e.detail.newValue)">
                                    <x-menuitem
                                        v-for="(language, languageWithBanner) in WINDOWS_LANGUAGES"
                                        :key="language"
                                        :value="language"
                                        :toggled="windowsLanguage === language"
                                        :disabled="['German', 'Hungarian'].includes(language)"
                                    >
                                        <x-label>
                                            {{ languageWithBanner }}
                                            <span
                                                v-if="['German', 'Hungarian'].includes(language)"
                                                class="text-red-400"
                                            >
                                                (Broken, use Language Pack)
                                            </span>
                                        </x-label>
                                    </x-menuitem>
                                </x-menu>
                            </x-select>
                        </div>
                        <div class="mt-4">
                            <div class="flex flex-col gap-2">
                                <label for="select-iso" class="text-xs text-neutral-400">Custom ISO (Optional)</label>
                                <div class="flex items-center gap-2">
                                    <x-button id="select-iso" class="text-sm w-64" @click="selectIsoFile">
                                        Select ISO File
                                    </x-button>
                                    <span class="relative group">
                                        <Icon icon="line-md:alert" class="text-neutral-400 cursor-pointer" />
                                        <span
                                            class="absolute bottom-5 left-[-160px] z-50 w-[320px] bg-neutral-900 text-xs text-gray-300 rounded-lg shadow-lg px-3 py-2 hidden group-hover:block transition-opacity duration-200 pointer-events-none"
                                        >
                                            We offer you the possibility of using a custom Windows ISO for your
                                            convenience, however we can't provide any support if your custom ISO breaks
                                            or certain features within WinBoat stop working.
                                        </span>
                                    </span>
                                </div>
                                <span
                                    v-if="customIsoPath"
                                    class="text-xs text-gray-400 font-semibold flex items-center gap-2"
                                >
                                    Selected: {{ customIsoFileName }}
                                    <x-button size="small" class="ml-2 px-2 py-0" @click="deselectIsoFile"
                                        >Remove</x-button
                                    >
                                </span>
                            </div>
                        </div>
                        <div class="flex flex-row gap-4 mt-6" :class="{ '!mt-2': customIsoPath }">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button toggled class="px-6" @click="currentStepIdx++">Next</x-button>
                        </div>
                    </div>

                    <!-- User Configuration -->
                    <div v-if="currentStep.id === StepID.USER_CONFIG" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">Configure the username and password for Windows.</p>

                        <p class="text-lg text-gray-400">
                            These credentials will be used to log in to the Windows virtual machine and to access it
                            through Remote Desktop Protocol (RDP). You will not be able to change these settings later
                            on unless you reinstall.
                        </p>

                        <div class="flex flex-row gap-4">
                            <div class="flex flex-col gap-4">
                                <div>
                                    <label for="select-username" class="text-sm mb-4 text-neutral-400">Username</label>
                                    <x-input
                                        id="select-username"
                                        class="w-64 max-w-64"
                                        type="text"
                                        minlength="2"
                                        maxlength="32"
                                        required
                                        size="large"
                                        :value="username"
                                        @input="(e: any) => (username = e.target.value)"
                                    >
                                        <x-icon href="#person"></x-icon>
                                        <x-label>Name</x-label>
                                    </x-input>
                                </div>

                                <div>
                                    <label for="select-password" class="text-sm mb-4 text-neutral-400">Password</label>
                                    <x-input
                                        id="select-password"
                                        class="w-64 max-w-64"
                                        type="password"
                                        minlength="2"
                                        maxlength="64"
                                        required
                                        size="large"
                                        :value="password"
                                        @input="(e: any) => (password = e.target.value)"
                                    >
                                        <x-icon href="#lock"></x-icon>
                                        <x-label>Password</x-label>
                                    </x-input>
                                </div>

                                <div>
                                    <label for="confirm-password" class="text-sm mb-4 text-neutral-400">
                                        Confirm Password
                                    </label>
                                    <x-input
                                        id="confirm-password"
                                        class="w-64 max-w-64"
                                        type="password"
                                        minlength="2"
                                        maxlength="64"
                                        required
                                        size="large"
                                        :value="confirmPassword"
                                        @input="(e: any) => (confirmPassword = e.target.value)"
                                    >
                                        <x-icon href="#lock" />
                                        <x-label>Confirm Password</x-label>
                                    </x-input>
                                </div>
                            </div>

                            <div class="flex flex-col gap-4 mt-6">
                                <div id="username-errors" class="h-[4rem] text-red-400 text-sm font-semibold space-y-1">
                                    <div v-for="error in usernameErrors" :key="error">
                                        <Icon icon="line-md:alert" class="inline size-4 -translate-y-0.5"></Icon>
                                        {{ error }}
                                    </div>
                                </div>
                                <div id="password-errors" class="text-red-400 text-sm font-semibold space-y-1">
                                    <div v-for="error in passwordErrors" :key="error">
                                        <Icon icon="line-md:alert" class="inline size-4 -translate-y-0.5"></Icon>
                                        {{ error }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-row gap-4 mt-6">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button
                                :disabled="usernameErrors.length || passwordErrors.length"
                                toggled
                                class="px-6"
                                @click="currentStepIdx++"
                            >
                                Next
                            </x-button>
                        </div>
                    </div>

                    <!-- Hardware Configuration -->
                    <div v-if="currentStep.id === StepID.HARDWARE_CONFIG" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            WinBoat utilizes a containerized KVM virtual machine to run Windows applications. Please
                            configure the hardware settings for the virtual machine.
                        </p>

                        <p class="text-lg text-gray-400">
                            It is not recommended to allocate more than half of your system resources to Windows. You
                            will be able to change these settings later on if needed.
                        </p>

                        <div class="flex flex-col gap-6">
                            <div>
                                <label for="select-cpu-cores" class="text-sm text-neutral-400">Select CPU Cores</label>
                                <div class="flex flex-row gap-4 items-center">
                                    <x-slider
                                        id="select-cpu-cores"
                                        @change="(e: any) => (cpuCores = Number(e.target.value))"
                                        class="w-[50%]"
                                        :value="cpuCores"
                                        :min="MIN_CPU_CORES"
                                        :max="specs.cpuCores"
                                        step="1"
                                        ticks
                                    />
                                    <x-label>{{ cpuCores }} Core{{ cpuCores > 1 ? "s" : "" }}</x-label>
                                </div>
                            </div>

                            <div>
                                <label for="select-ram" class="text-sm text-neutral-400">
                                    Select RAM
                                    <span
                                        v-if="ramGB < RECOMMENDED_VM_RAM_GB || memoryInfo.availableGB < ramGB"
                                        class="relative group text-white font-bold text-xs rounded-full bg-red-600 px-2 pb-0.5 ml-2 hover:bg-red-700 transition"
                                    >
                                        <Icon icon="line-md:alert" class="inline size-4 -translate-y-0.5" />
                                        Warning
                                        <span
                                            class="absolute bottom-5 right-[-160px] z-50 w-[320px] bg-neutral-900 text-xs text-gray-300 rounded-lg shadow-lg px-3 py-2 hidden group-hover:block transition-opacity duration-200 pointer-events-none"
                                        >
                                            <span v-if="ramGB < RECOMMENDED_VM_RAM_GB" class="block">
                                                Allocating less than the recommended {{ RECOMMENDED_VM_RAM_GB }} GB of
                                                RAM may limit Windows performance.
                                            </span>
                                            <span v-if="memoryInfo.availableGB < ramGB" class="block">
                                                You don't have enough unused memory available to allocate the requested
                                                amount of RAM. You currently have ~{{ memoryInfo.availableGB }} GB of
                                                unused memory available. If you continue with this amount of RAM, the
                                                container will likely crash.
                                            </span>
                                        </span>
                                    </span>
                                </label>
                                <div class="flex flex-row gap-4 items-center">
                                    <x-slider
                                        id="select-ram"
                                        @change="(e: any) => (ramGB = Number(e.target.value))"
                                        class="w-[50%]"
                                        :value="ramGB"
                                        :min="MIN_VM_RAM_GB"
                                        :max="specs.ramGB"
                                        step="1"
                                    />
                                    <x-label>{{ ramGB }} GB</x-label>
                                </div>
                            </div>

                            <div>
                                <label for="select-disk" class="text-sm text-neutral-400">
                                    Select Disk Size
                                    <span
                                        v-if="(installFolderDiskSpaceGB || 0) - diskSpaceGB < 5"
                                        class="relative group text-white font-bold text-xs rounded-full bg-red-600 px-2 pb-0.5 ml-2 hover:bg-red-700 transition"
                                    >
                                        <Icon icon="line-md:alert" class="inline size-4 -translate-y-0.5"></Icon>
                                        Warning
                                        <span
                                            class="absolute bottom-5 right-[-160px] z-50 w-[320px] bg-neutral-900 text-xs text-gray-300 rounded-lg shadow-lg px-3 py-2 hidden group-hover:block transition-opacity duration-200 pointer-events-none"
                                        >
                                            You're about to allocate most of your remaining disk space with less than
                                            5GB in excess. You currently have ~{{ installFolderDiskSpaceGB }} GB of disk
                                            space available for the drive corresponding to {{ installFolder }}. If you
                                            continue with this disk size, you may run out of space and encounter
                                            unexpected issues.
                                        </span>
                                    </span>
                                </label>
                                <div class="flex flex-row gap-4 items-center">
                                    <x-slider
                                        id="select-disk"
                                        @change="(e: any) => (diskSpaceGB = Number(e.target.value))"
                                        class="w-[50%]"
                                        :value="diskSpaceGB"
                                        :min="MIN_DISK_GB"
                                        :max="installFolderDiskSpaceGB || 0"
                                        step="8"
                                    />
                                    <x-label>{{ diskSpaceGB }} GB</x-label>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-row gap-4 mt-6">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button toggled class="px-6" @click="currentStepIdx++">Next</x-button>
                        </div>
                    </div>

                    <!-- Folder Sharing -->
                    <div v-if="currentStep.id === StepID.SHOULD_SHARE_HOME_FOLDER" class="step-block">
                        <h1 class="text-3xl font-semibold">Folder Sharing</h1>
                        <p class="text-lg text-gray-400">
                            WinBoat allows you to share a folder from your Linux system with the Windows virtual machine.
                            You can choose whether to enable this feature and select which folder to share.
                        </p>
                        <p class="text-lg text-gray-400">
                            <b>⚠️ WARNING:</b>
                            Sharing a folder exposes your Linux files to Windows-specific malware and viruses.
                            Only enable this feature if you understand the risks involved. Always be careful with the
                            files you download and open in Windows.
                        </p>

                        <x-checkbox
                            class="my-4"
                            @toggle="folderSharing = !folderSharing"
                            :toggled="folderSharing"
                        >
                            <x-label><strong>Enable folder sharing</strong></x-label>
                            <x-label class="text-gray-400">
                                By checking this box, you acknowledge the risks mentioned above
                            </x-label>
                        </x-checkbox>

                        <div v-if="folderSharing" class="flex flex-col gap-2 my-4">
                            <label class="text-sm text-neutral-400">Shared Folder Location</label>
                            <div class="flex flex-row items-center">
                                <x-input
                                    type="text"
                                    placeholder="Select Folder to Share"
                                    readonly
                                    :value="sharedFolderPath"
                                    class="!max-w-full w-[300px] rounded-r-none"
                                >
                                    <x-icon href="#folder"></x-icon>
                                    <x-label>/your/shared/folder</x-label>
                                </x-input>
                                <x-button class="!rounded-l-none" toggled @click="selectSharedFolder">
                                    {{ sharedFolderPath ? "Change" : "Select" }}
                                </x-button>
                            </div>
                        </div>

                        <div class="flex flex-row gap-4 mt-6">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button
                                toggled
                                class="px-6"
                                @click="currentStepIdx++"
                                :disabled="folderSharing && !sharedFolderPath"
                            >
                                Next
                            </x-button>
                        </div>
                    </div>

                    <!-- Review -->
                    <div v-if="currentStep.id === StepID.REVIEW" class="step-block">
                        <h1 class="text-3xl font-semibold">{{ currentStep.title }}</h1>
                        <p class="text-lg text-gray-400">
                            Please review the settings you've chosen for your WinBoat installation. If everything looks
                            correct, click "Install" to begin.
                        </p>

                        <div class="bg-neutral-800 p-6 rounded-lg flex flex-col gap-4">
                            <h2 class="text-xl font-medium text-white mt-0 mb-2">Your Configuration</h2>

                            <div class="grid grid-cols-2 gap-4">
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">Container Runtime</span>
                                    <span class="text-base text-white">{{ containerRuntime }}</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">Language</span>
                                    <span class="text-base text-white">{{ windowsLanguage }}</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">Windows Version</span>
                                    <span class="text-base text-white">{{ WINDOWS_VERSIONS[windowsVersion] }}</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">CPU Cores</span>
                                    <span class="text-base text-white">{{ cpuCores }} Cores</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">RAM</span>
                                    <span class="text-base text-white">{{ ramGB }} GB</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">Disk Size</span>
                                    <span class="text-base text-white">{{ diskSpaceGB }} GB</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">Username</span>
                                    <span class="text-base text-white">{{ username }}</span>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm text-gray-400">Install Location</span>
                                    <span class="text-base text-white">{{ installFolder }}</span>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-row gap-4 mt-6">
                            <x-button class="px-6" @click="currentStepIdx--">Back</x-button>
                            <x-button
                                toggled
                                class="px-6"
                                @click="
                                    currentStepIdx++;
                                    install();
                                "
                            >
                                Install
                            </x-button>
                        </div>
                    </div>

                    <!-- Installation -->
                    <div v-if="currentStep.id === StepID.INSTALL" class="step-block">
                        <h1 class="text-3xl font-semibold">Installation</h1>
                        <p class="text-lg text-gray-400 text-justify">
                            WinBoat is now installing Windows. Please be patient as this may take up to an hour. In the
                            meantime, you can grab a coffee and check the installation status
                            <span v-if="linkableInstallSteps.includes(installState)">
                                <a :href="NOVNC_URL" @click="openAnchorLink">in your browser</a>.
                            </span>
                            <span v-else>
                                over at
                                <div
                                    style="animation-duration: 3s!important;"
                                    class="ml-1 inline-block relative text-transparent rounded-md bg-neutral-700 animate-pulse select-none"
                                >
                                    in your browser
                                    <Icon icon="eos-icons:three-dots-loading" class="pointer-events-none absolute top-0 left-[50%] size-16 text-violet-400 -translate-x-[50%] -translate-y-[27.5%]"></Icon>
                                </div>
                            </span>
                        </p>

                        <!-- Installing -->
                        <div
                            v-if="
                                installState !== InstallStates.COMPLETED && installState !== InstallStates.INSTALL_ERROR
                            "
                            class="flex flex-col h-full items-center justify-center gap-4"
                        >
                            <x-throbber class="size-16"></x-throbber>
                            <x-label
                                v-if="installState !== InstallStates.MONITORING_PREINSTALL"
                                class="text-lg text-gray-400 text-center"
                            >
                                {{ installState }}...
                            </x-label>
                            <x-label v-else class="text-lg text-gray-400 text-center">
                                {{ preinstallMsg }}
                            </x-label>
                        </div>

                        <!-- Error -->
                        <div
                            v-if="installState === InstallStates.INSTALL_ERROR"
                            class="flex flex-col h-full items-center justify-center gap-4"
                        >
                            <Icon icon="line-md:alert" class="size-16 text-red-500"></Icon>
                            <x-label class="text-lg text-gray-400 text-center">
                                An error occurred while installing Windows. Please check the logs in
                                <span class="font-mono bg-neutral-700 rounded-md px-0.5">~/.winboat</span>
                                and verify
                                <span class="font-mono bg-neutral-700 rounded-md px-0.5"
                                    >{{ installManager!.container.executableAlias }} logs WinBoat</span
                                >
                                in your terminal for more information.
                            </x-label>
                            <x-label class="text-lg text-gray-400 text-center">
                                To reset and try again, follow
                                <a href="https://rentry.org/winboat_retry_install" @click="openAnchorLink">these</a>
                                instructions.
                            </x-label>
                        </div>

                        <!-- Completed -->
                        <div
                            v-if="installState === InstallStates.COMPLETED"
                            class="flex flex-col h-full items-center justify-center gap-4"
                        >
                            <Icon icon="line-md:confirm-circle" class="size-16 text-green-500"></Icon>
                            <x-label class="text-lg text-gray-400 text-center">
                                Windows has been installed successfully!
                            </x-label>
                            <x-button @click="$router.push('/home')">Finish</x-button>
                        </div>
                    </div>
                </div>
            </Transition>
        </div>
        <div class="absolute gradient-bg left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] -z-10"></div>
    </div>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { computedAsync } from "@vueuse/core";
import { InstallConfiguration, Specs } from "../../types";
import { getSpecs, getMemoryInfo, defaultSpecs, satisfiesPrequisites, type MemoryInfo } from "../lib/specs";
import {
    MIN_HOST_RAM_GB,
    MIN_VM_RAM_GB,
    NOVNC_URL,
    RECOMMENDED_VM_RAM_GB,
    WINDOWS_VERSIONS,
    WINDOWS_LANGUAGES,
    type WindowsVersionKey,
} from "../lib/constants";
import { InstallManager, InstallStates } from "../lib/install";
import { openAnchorLink } from "../utils/openLink";
import { setIntervalImmediately } from "../utils/interval";
import license from "../assets/LICENSE.txt?raw";
import { ContainerRuntimes, getContainerSpecs, type ContainerSpecs } from "../lib/containers/common";
import { WinboatConfig } from "../lib/config";

const path: typeof import("path") = require("node:path");
const electron: typeof import("electron") = require("electron").remote || require("@electron/remote");
const fs: typeof import("fs") = require("node:fs");
const os: typeof import("os") = require("node:os");
const checkDiskSpace: typeof import("check-disk-space").default = require("check-disk-space").default;

type Step = {
    id: string;
    title: string;
    icon: string;
};

enum StepID {
    WELCOME = "STEP_WELCOME",
    PREREQUISITES = "STEP_PREREQUISITES",
    LICENSE = "STEP_LICENSE",
    INSTALL_LOCATION = "STEP_INSTALL_LOCATION",
    WINDOWS_CONFIG = "STEP_WINDOWS_CONFIG",
    HARDWARE_CONFIG = "STEP_HARDWARE_CONFIG",
    USER_CONFIG = "STEP_USER_CONFIG",
    SHOULD_SHARE_HOME_FOLDER = "STEP_SHOULD_SHARE_HOME_FOLDER",
    REVIEW = "STEP_OVERVIEW",
    INSTALL = "STEP_INSTALL",
    FINISH = "STEP_FINISH",
}

const steps: Step[] = [
    {
        id: StepID.WELCOME,
        title: "Welcome to WinBoat",
        icon: "tdesign:wave-bye-filled",
    },
    {
        id: StepID.LICENSE,
        title: "License Agreement",
        icon: "line-md:text-box-multiple",
    },
    {
        id: StepID.PREREQUISITES,
        title: "Pre-Requisites",
        icon: "line-md:check-all",
    },
    {
        id: StepID.INSTALL_LOCATION,
        title: "Install Location",
        icon: "line-md:folder-arrow-down-filled",
    },
    {
        id: StepID.WINDOWS_CONFIG,
        title: "Configure Windows",
        icon: "mage:microsoft-windows",
    },
    {
        id: StepID.USER_CONFIG,
        title: "User Configuration",
        icon: "line-md:account",
    },
    {
        id: StepID.HARDWARE_CONFIG,
        title: "Hardware Configuration",
        icon: "famicons:hardware-chip-outline",
    },
    {
        id: StepID.SHOULD_SHARE_HOME_FOLDER,
        title: "Folder Sharing",
        icon: "line-md:link",
    },
    {
        id: StepID.REVIEW,
        title: "Review",
        icon: "solar:pin-list-bold",
    },
    {
        id: StepID.INSTALL,
        title: "Installation",
        icon: "line-md:downloading-loop",
    },
    {
        id: StepID.FINISH,
        title: "Finish",
        icon: "bx:bxs-check-circle",
    },
];

const MIN_CPU_CORES = 1;
const MIN_DISK_GB = 32;
const PREREQUISITE_REFRESH_INTERVAL_MS = 5000;
const $router = useRouter();
const specs = ref<Specs>({ ...defaultSpecs });
const currentStepIdx = ref(0);
const currentStep = computed(() => steps[currentStepIdx.value]);
const installFolder = ref(path.join(os.homedir(), "winboat"));
const windowsVersion = ref<WindowsVersionKey>("11");
const windowsLanguage = ref("English");
const customIsoPath = ref("");
const customIsoFileName = ref("");
const cpuCores = ref(2);
const ramGB = ref(RECOMMENDED_VM_RAM_GB);
const memoryInfo = ref<MemoryInfo>({ totalGB: 0, availableGB: 0 });
const memoryInterval = ref<NodeJS.Timeout | null>(null);
const diskSpaceGB = ref(32);
const username = ref("winboat");
const password = ref("");
const confirmPassword = ref("");
const folderSharing = ref(false);
const sharedFolderPath = ref("");
const installState = ref<InstallStates>(InstallStates.IDLE);
const preinstallMsg = ref("");
const containerRuntime = ref(ContainerRuntimes.DOCKER);
const containerSpecs = ref<ContainerSpecs>();
const checkingPrerequisites = ref(false);
const prerequisiteRefreshSequence = ref(0);
let prerequisiteInterval: NodeJS.Timeout | null = null;
let prerequisiteRefreshQueued = false;
// These are the install steps where the container is actually up and running
const linkableInstallSteps = [ InstallStates.MONITORING_PREINSTALL, InstallStates.INSTALLING_WINDOWS, InstallStates.COMPLETED ];

let installManager: InstallManager | null;

onMounted(async () => {
    memoryInfo.value = await getMemoryInfo();
    memoryInterval.value = setInterval(async () => {
        memoryInfo.value = await getMemoryInfo();
    }, 1000);
    console.log("Memory Info", memoryInfo.value);

    username.value = os.userInfo().username;
    console.log("Username", username.value);

    // Set default shared folder path to home directory
    sharedFolderPath.value = os.homedir();
});

onUnmounted(() => {
    if (memoryInterval.value) {
        clearInterval(memoryInterval.value);
    }

    stopPrerequisitePolling();
});

watch(currentStep, step => {
    stopPrerequisitePolling();

    if (step.id === StepID.PREREQUISITES) {
        prerequisiteInterval = setIntervalImmediately(() => {
            prerequisiteRefreshSequence.value++;
            void refreshPrerequisites();
        }, PREREQUISITE_REFRESH_INTERVAL_MS);
    }
});

// Watch for when folder sharing is enabled and set default path
watch(folderSharing, (newValue) => {
    if (newValue && !sharedFolderPath.value) {
        sharedFolderPath.value = os.homedir();
    }
});

async function refreshPrerequisites() {
    if (checkingPrerequisites.value) {
        prerequisiteRefreshQueued = true;
        return;
    }

    checkingPrerequisites.value = true;

    try {
        do {
            prerequisiteRefreshQueued = false;
            const runtime = containerRuntime.value;
            const [newSpecs, newContainerSpecs] = await Promise.all([getSpecs(), getContainerSpecs(runtime)]);

            if (runtime === containerRuntime.value) {
                specs.value = newSpecs;
                containerSpecs.value = newContainerSpecs;
            } else {
                prerequisiteRefreshQueued = true;
            }
        } while (prerequisiteRefreshQueued);
    } catch (e) {
        console.error("Error checking prerequisites:", e);
    } finally {
        checkingPrerequisites.value = false;
    }
}

function stopPrerequisitePolling() {
    prerequisiteRefreshQueued = false;
    if (!prerequisiteInterval) return;

    clearInterval(prerequisiteInterval);
    prerequisiteInterval = null;
}

function handleContainerRuntimeChange(e: CustomEvent<{ newValue: ContainerRuntimes }>) {
    containerSpecs.value = undefined;
    containerRuntime.value = e.detail.newValue;
    void refreshPrerequisites();
}

function continueFromPrerequisites() {
    if (!satisfiesPrequisites(specs.value, containerSpecs.value)) return;
    currentStepIdx.value++;
}

function containerInstalled(containerSpecs: ContainerSpecs | undefined) {
    if (!containerSpecs) return false;
    if ("dockerInstalled" in containerSpecs) return containerSpecs.dockerInstalled;
    if ("podmanInstalled" in containerSpecs) return containerSpecs.podmanInstalled;
    return false;
}

const usernameErrors = computed(() => {
    let errors: string[] = [];

    // At least 2 characters
    if (username.value.length < 2) {
        errors.push("Must be at least 2 characters long");
    }

    // Only ASCII letters, numbers, and dashes are allowed
    if (!/^[a-zA-Z0-9-]+$/.test(username.value)) {
        errors.push("Must only contain ASCII letters, numbers, and dashes");
    }

    return errors;
});

const passwordErrors = computed(() => {
    let errors: string[] = [];

    // Must match confirm password
    if (password.value !== confirmPassword.value) {
        errors.push("Passwords do not match");
    }

    // Only alphanumeric characters are allowed
    if (!/^[a-zA-Z0-9]+$/.test(password.value)) {
        errors.push("Must only contain alphanumeric characters");
    }

    // At least 4 characters
    if (password.value.length < 4) {
        errors.push("Must be at least 4 characters long");
    }

    return errors;
});

function selectIsoFile() {
    electron.dialog
        .showOpenDialog({
            title: "Select ISO File",
            filters: [
                {
                    name: "ISO Files",
                    extensions: ["iso"],
                },
            ],
            properties: ["openFile"],
        })
        .then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                customIsoPath.value = result.filePaths[0];
                customIsoFileName.value = path.basename(result.filePaths[0]);
                windowsLanguage.value = "English"; // Language can't be custom
                windowsVersion.value = "custom";
                console.log("ISO path updated:", customIsoPath.value);
            }
        });
}

function deselectIsoFile() {
    customIsoPath.value = "";
    customIsoFileName.value = "";
    windowsLanguage.value = "English";
    windowsVersion.value = "11";
}

function selectInstallFolder() {
    electron.dialog
        .showOpenDialog({
            title: "Select Install Folder",
            properties: ["openDirectory", "createDirectory"],
        })
        .then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                const selectedPath = result.filePaths[0];
                const finalPath = path.join(selectedPath, "winboat");
                console.log("Install path selected:", finalPath);
                installFolder.value = finalPath;
            }
        });
}

const installFolderErrors = computedAsync(async () => {
    let errors: string[] = [];

    if (!installFolder.value) {
        errors.push("Please select an install location");
        return errors; // <- The rest shouldn't be ran if no path is selected
    }

    // Path without /winboat
    const parentPath = path.dirname(installFolder.value);
    console.log("Parent path", parentPath);

    // Check if path is writable
    try {
        fs.accessSync(parentPath, fs.constants.W_OK);
    } catch (err) {
        console.error(err);
        errors.push("The selected install location is not writable");
    }

    // Create /winboat
    const winboatPath = path.join(parentPath, "winboat");
    const isWinboatPathCreated = false;
    try {
        fs.mkdirSync(winboatPath, { recursive: true });
        isWinboatPathCreated = true;
        console.log("Created winboat directory at", winboatPath);
    } catch (err) {
        console.error(err);
    }

    // Check if we have enough disk space
    const diskSpace = await checkDiskSpace(isWinboatPathCreated ? winboatPath : parentPath);
    if (isWinboatPathCreated) {
        await fs.rm(winboatPath, { recursive: true });
    }
    const freeGB = Math.floor(diskSpace.free / (1024 * 1024 * 1024));
    if (freeGB < MIN_DISK_GB) {
        errors.push(
            `Not enough disk space available. At least ${MIN_DISK_GB} GB is required, but only ${freeGB} GB is available.`,
        );
    }

    return errors;
});

const installFolderDiskSpaceGB = computedAsync(async () => {
    if (!installFolder.value) return 0;

    const parentPath = path.dirname(installFolder.value);
    const diskSpace = await checkDiskSpace(parentPath);
    const freeGB = Math.floor(diskSpace.free / (1024 * 1024 * 1024));
    return freeGB;
});

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

function install() {
    const installConfig: InstallConfiguration = {
        windowsVersion: windowsVersion.value,
        windowsLanguage: windowsLanguage.value,
        cpuCores: cpuCores.value,
        ramGB: ramGB.value,
        installFolder: installFolder.value,
        diskSpaceGB: diskSpaceGB.value,
        username: username.value,
        password: password.value,
        sharedFolderPath: folderSharing.value ? sharedFolderPath.value : undefined,
        ...(customIsoPath.value ? { customIsoPath: customIsoPath.value } : {}),
        container: containerRuntime.value, // Hardcdde for now
    };

    const wbConfig = WinboatConfig.getInstance(); // Create winboat config.
    wbConfig.config.containerRuntime = containerRuntime.value; // Save which runtime to use.

    installManager = new InstallManager(installConfig);

    // Begin installation and attach event listeners
    installManager.emitter.on("stateChanged", newState => {
        installState.value = newState;
        console.log("Install state changed", newState);
    });

    installManager.emitter.on("preinstallMsg", msg => {
        preinstallMsg.value = msg;
        console.log("Preinstall msg", msg);
    });

    installManager.install();
}
</script>

<style>
.gradient-bg {
    width: 90vw;
    height: 80vh;
    border-radius: 10px;
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
    filter: blur(50px);
}

.step-block {
    @apply flex flex-col gap-4 h-full justify-center;
}

.prerequisite-refresh-progress {
    transform-origin: left;
    animation: prerequisite-refresh 5s linear forwards;
}

@keyframes prerequisite-refresh {
    from {
        transform: scaleX(0);
    }
    to {
        transform: scaleX(1);
    }
}

.flex p {
    margin-top: 5px;
    margin-bottom: 5px;
}

/* Transitions */
.bounce-enter-active {
    animation: bounce-in 0.4s;
}
.bounce-leave-active {
    animation: bounce-in 0.4s reverse;
}

@keyframes bounce-in {
    0% {
        transform: scale(0.7) translateY(-20%);
        opacity: 0%;
    }
    100% {
        transform: scale(1) translateY(0);
    }
}

.bouncedown-enter-active {
    animation: bouncedown-in 0.5s;
}
.bouncedown-leave-active {
    animation: bouncedown-in 0.5s reverse;
}
@keyframes bouncedown-in {
    0% {
        transform: scale(0.7) translateY(-20%);
        opacity: 0%;
    }
    100% {
        transform: scale(1) translateY(0);
    }
}
</style>

<template>
    <dialog ref="dialog">
        <h3 class="mb-2">{{ editing ? "Edit Shortcut" : "Create Shortcut" }}</h3>
        <div class="flex gap-5 mt-4 w-[35vw] min-w-[400px] max-w-[75vw]">
            <div class="flex flex-none items-center">
                <img
                    v-if="target?.Icon"
                    :src="target.Icon.startsWith('data:') ? target.Icon : `data:image/png;base64,${target.Icon}`"
                    class="size-24 object-contain"
                    alt="Application icon"
                />
            </div>
            <div class="flex flex-col gap-1 w-full">
                <x-label>Name</x-label>
                <x-input :value="name" @input="name = $event.target.value" class="!max-w-full" />
                <x-label class="mt-3">Location</x-label>
                <x-select @change="destination = $event.detail.newValue" class="!max-w-full">
                    <x-menu>
                        <x-menuitem
                            v-for="(label, value) in destinations"
                            :key="value"
                            :value="value"
                            :toggled="destination === value"
                        >
                            <x-label>{{ label }}</x-label>
                        </x-menuitem>
                    </x-menu>
                </x-select>
                <x-label class="mt-3">Extra Windows arguments</x-label>
                <x-input
                    :value="extraArgs"
                    @input="extraArgs = $event.target.value"
                    class="!max-w-full"
                    placeholder="Optional"
                />
            </div>
        </div>
        <p class="text-sm text-neutral-400 max-w-[35vw]">
            Your shortcut will use your current WinBoat settings. Extra arguments are added to the application's
            existing arguments.
        </p>
        <p v-if="error" class="text-red-400 max-w-[35vw] break-words">{{ error }}</p>
        <footer>
            <x-button @click="dialog?.close()"><x-label>Cancel</x-label></x-button>
            <x-button toggled :disabled="!name.trim()" @click="save"
                ><x-label>{{ editing ? "Save" : "Create Shortcut" }}</x-label></x-button
            >
        </footer>
    </dialog>
</template>

<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import type { Shortcut, WinApp } from "../../types";
import { readLauncher, saveShortcut, shortcutFor } from "../lib/shortcut-files";

const dialog = useTemplateRef("dialog");
const destinations: Record<Shortcut["destination"], string> = {
    desktop: "Desktop",
    applications: "Applications menu",
    both: "Both",
};
const target = ref<WinApp | null>(null);
const name = ref("");
const extraArgs = ref("");
const destination = ref<Shortcut["destination"]>("desktop");
const editing = ref(false);
const error = ref("");

function open(app: WinApp) {
    const existing = shortcutFor(app);
    target.value = { Name: app.Name, Path: app.Path, Args: app.Args, Source: app.Source, Icon: app.Icon };
    name.value = existing?.name ?? app.Name;
    extraArgs.value = existing?.extraArgs ?? "";
    destination.value = existing?.destination ?? "desktop";
    editing.value = !!existing;
    error.value = "";
    dialog.value?.showModal();
}

function save() {
    if (!target.value) return;
    error.value = "";
    try {
        if (!readLauncher())
            throw new Error("Open an installed WinBoat build once before creating shortcuts in development mode.");
        saveShortcut({
            app: target.value,
            name: name.value,
            extraArgs: extraArgs.value,
            destination: destination.value,
        });
        dialog.value?.close();
    } catch (e) {
        error.value = String(e);
    }
}
defineExpose({ open });
</script>

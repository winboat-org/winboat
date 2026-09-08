<template>
    <x-card
        class="flex flex-row justify-between items-center p-2 py-3 my-0 w-full backdrop-blur-xl backdrop-brightness-150 bg-neutral-800/20"
    >
        <div>
            <div class="flex flex-row gap-2 items-center mb-2">
                <Icon class="inline-flex text-violet-400 size-8" :icon="props.icon"></Icon>
                <h1 class="my-0 text-lg font-semibold">{{ props.title }}</h1>
            </div>
            <p class="text-neutral-400 text-[0.9rem] !pt-0 !mt-0">
                <slot name="desc">{{ props.desc }}</slot>
            </p>
        </div>
        <div class="flex flex-row gap-2 justify-center items-center">
            <slot v-if="props.type === 'custom'"/>
            <template v-else-if="props.type === 'number'">
                <x-button
                    v-if="props.step"
                    type="button"
                    class="size-8 !p-0"
                    @click="() => applyStep(-props.step!)"
                >
                    <Icon icon="mdi:minus" class="size-4"></Icon>
                    <x-label class="sr-only">Subtract</x-label>
                </x-button>
                <x-input
                    class="max-w-16 text-right text-[1.1rem]"
                    :min="props.min"
                    :max="props.max"
                    :value="value"
                    v-on:keydown="(e: any) => ensureNumericInput(e)"
                    @input="(e: any) => (value = Number(/^\d+$/.exec(e.target.value)![0] || props.min))"
                    required
                />
                <x-button
                    v-if="props.step"
                    type="button"
                    class="size-8 !p-0"
                    @click="() => applyStep(props.step!)"
                >
                    <Icon icon="mdi:plus" class="size-4"></Icon>
                    <x-label class="sr-only">Add</x-label>
                </x-button>
                <p class="text-neutral-100">{{ props.unit }}</p>
            </template>
            <template v-else-if="props.type === 'dropdown'">
                <x-select
                    class="min-w-20"
                    @change="(e: any) => (value = e.detail.newValue)"
                >
                    <x-menu>
                        <x-menuitem v-for="(opt, key) in props.options" :value="opt" :key="key" :toggled="value === opt">
                            <x-label>{{ props.optionLabels?.[opt] ?? opt }}{{ props.unit ?? '' }}</x-label>
                        </x-menuitem>
                    </x-menu>
                </x-select>
            </template>
            <template v-else-if="props.type === 'switch'">
                <x-switch
                    :toggled="value"
                    @toggle="(_: any) => { $emit('toggle'); (value = !value) }"
                    size="large"
                />
            </template>
        </div>
    </x-card>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue";

type PropsType = {
    /**
     * The icon displayed in the top-left corner of the card. Only accepts Iconify icon name format.
     * @example "fluent:folder-link-32-filled"
     */
    icon: string;

    /**
     * The title text displayed next to the icon.
     */
    title: string;

    /**
     * The description of the card. It will be displayed as a <p> tag.
     * In case you need more control over how the description is displayed, use the `desc` slot instead.
     */
    desc?: string;

    /**
     * Specifies the nature of the input value.
     * - `number`: Shows a numeric input with optional Add/Subtract buttons in case `step` is specified.
     * - `dropdown`: Shows a dropdown menu with values defined by the `options` prop.
     * - `switch`: Shows a toggle switch.
     * - `custom`: Shows the default slot content.
     */
    type: "number" | "dropdown" | "switch" | "custom";
    
    /**
     * The minimum accepted value in case the `number` type is specified.
     */
    min?: number;

    /**
     * The maximum accepted value in case the `number` type is specified.
     */
    max?: number;

    /**
     * Specifies how much the Add/Subtract buttons change the input value.
     * Can be omitted, in which case the buttons won't be shown.
     */
    step?: number;

    /**
     * Can be used to append some text after dropdown selections or a number input.
     */
    unit?: string;

    /**
     * Defines dropdown entries in case the `dropdown` type is specified.
     */
    options?: any[];
    optionLabels?: Record<string, string>;
};

const props = defineProps<PropsType>();
defineEmits<{ toggle: [] }>();
const value = defineModel("value");

function ensureNumericInput(e: any) {
    if (e.metaKey || e.ctrlKey || e.which <= 0 || e.which === 8 || e.key === "ArrowRight" || e.key === "ArrowLeft") {
        return;
    }

    if (!/\d/.test(e.key)) {
        e.preventDefault();
    }
}

function applyStep(step: number) {
    let tmp = Number.parseInt(value.value as string);

    if (Number.isNaN(tmp)) return;

    tmp += step;

    if(!props.min && !props.max) {
        value.value = tmp;
        return;
    }

    value.value = Math.min(Math.max(props.min ?? Number.MIN_SAFE_INTEGER, tmp), props.max ?? Number.MAX_SAFE_INTEGER);
}
</script>

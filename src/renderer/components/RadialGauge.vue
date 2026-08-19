<template>
    <svg class="radial-gauge" viewBox="0 0 120 120" role="img" :aria-label="`${formattedValue} percent`">
        <circle class="radial-gauge__track" cx="60" cy="60" r="42" pathLength="100" />
        <circle
            class="radial-gauge__value"
            cx="60"
            cy="60"
            r="42"
            pathLength="100"
            :style="{ strokeDasharray: `${arcValue} ${100 - arcValue}` }"
        />
        <text class="radial-gauge__label" x="60" y="64">{{ formattedValue }}%</text>
    </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ value: number }>();
const normalizedValue = computed(() => Math.min(100, Math.max(0, Number(props.value) || 0)));
const arcValue = computed(() => normalizedValue.value * 0.75);
const formattedValue = computed(() => normalizedValue.value.toFixed(1));
</script>

<style scoped>
.radial-gauge {
    flex: 0 0 120px;
    width: 120px;
    height: 120px;
}

.radial-gauge__track,
.radial-gauge__value {
    fill: none;
    stroke-linecap: round;
    stroke-width: 8;
    transform: rotate(135deg);
    transform-origin: 60px 60px;
}

.radial-gauge__track {
    stroke: #18181b;
    stroke-dasharray: 75 25;
}

.radial-gauge__value {
    stroke: #a78af9;
    transition: stroke-dasharray 200ms ease;
}

.radial-gauge__label {
    fill: #fff;
    font-size: 12px;
    text-anchor: middle;
}
</style>

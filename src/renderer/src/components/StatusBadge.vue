<script setup lang="ts">
// PX Dev — StatusBadge Component
// Pill badge tinted by status color; running/starting shows a pulsing dot.

import { computed } from 'vue'
import { STATUS_CONFIG } from '@shared/constants/status'
import type { ProcessStatus } from '@shared/types'

const props = defineProps<{
  status: ProcessStatus
}>()

const config = computed(() => STATUS_CONFIG[props.status] ?? STATUS_CONFIG.unknown)
const isLive = computed(() => props.status === 'running' || props.status === 'starting')
</script>

<template>
  <span
    class="status-badge"
    :style="{ '--badge-color': config.color }"
  >
    <span class="badge-dot" :class="{ pulse: isLive }" />
    <span class="badge-label">{{ config.label }}</span>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 8px;
  border-radius: var(--r-full);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: var(--badge-color);
  background: color-mix(in srgb, var(--badge-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--badge-color) 28%, transparent);
  white-space: nowrap;
}

.badge-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
  background: var(--badge-color);
  flex-shrink: 0;
}

.badge-dot.pulse {
  animation: badge-pulse 1.6s var(--ease-out) infinite;
}

@keyframes badge-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--badge-color) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 5px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
</style>

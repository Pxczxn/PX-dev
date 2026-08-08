<script setup lang="ts">
// PX Dev — StatCard Component
// Statistic card with an accent-tinted icon chip, large number and hover lift.

import { NCard } from 'naive-ui'

defineProps<{
  label: string
  value: number | string
  icon?: string
  color?: string
}>()
</script>

<template>
  <NCard
    size="small"
    class="stat-card"
    :bordered="false"
    :style="{ '--stat-color': (color ?? '#2b8cff') as string }"
  >
    <div class="stat-content">
      <div class="stat-text">
        <div class="stat-value">{{ value }}</div>
        <div class="stat-label">{{ label }}</div>
      </div>
      <div v-if="icon" class="stat-chip">{{ icon }}</div>
    </div>
  </NCard>
</template>

<style scoped>
.stat-card {
  position: relative;
  overflow: hidden;
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  transition: transform var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out),
    border-color var(--dur-2) var(--ease-out);
}

.stat-card :deep(.n-card__content) {
  padding: 18px 20px;
}

.stat-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--stat-color);
  opacity: 0.9;
}

.stat-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-2);
  border-color: var(--border-default);
}

.stat-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.stat-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.stat-label {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3);
  font-weight: 500;
}

.stat-chip {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: color-mix(in srgb, var(--stat-color) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stat-color) 24%, transparent);
}
</style>

<script setup lang="ts">
// PX Dev — StatCard 组件
// 仪表盘统计卡片，带左侧颜色条、CSS 变量色、悬停上浮效果
// 图标改为 SVG，颜色使用 CSS 变量，不再依赖硬编码色值

import { NCard, NIcon } from 'naive-ui'
import { useRouter } from 'vue-router'
import type { Component } from 'vue'

const props = defineProps<{
  label: string
  value: number | string
  icon?: Component    // SVG 图标组件（来自 @vicons/ionicons5）
  color?: string     // CSS 变量名，如 'var(--c-running)'，默认为 accent
  to?: string
}>()

const router = useRouter()

function handleClick(to?: string): void {
  if (to) router.push(to)
}
</script>

<template>
  <NCard
    size="small"
    class="stat-card"
    :class="{ 'stat-card--clickable': !!to }"
    :bordered="false"
    :style="{ '--stat-color': color ?? 'var(--accent)' }"
    @click="handleClick(to)"
  >
    <div class="stat-content">
      <div class="stat-text">
        <!-- 数值 + 标签 -->
        <div class="stat-value">{{ value }}</div>
        <div class="stat-label">{{ label }}</div>
      </div>

      <!-- 图标区域 -->
      <div v-if="icon" class="stat-icon">
        <NIcon :component="icon" :size="22" />
      </div>
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
  transition:
    transform var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out),
    border-color var(--dur-2) var(--ease-out);
}

.stat-card :deep(.n-card__content) {
  padding: 16px 18px;
}

/* 左侧竖条颜色 */
.stat-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--stat-color);
  opacity: 0.85;
  border-radius: var(--r-full) 0 0 var(--r-full);
}

/* 悬停：上浮 + 光晕 */
.stat-card--clickable {
  cursor: pointer;
}

.stat-card--clickable:hover {
  transform: var(--hover-lift);
  box-shadow: var(--glow-md);
  border-color: var(--border-default);
}

.stat-card--clickable:hover .stat-icon {
  background: color-mix(in srgb, var(--stat-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--stat-color) 30%, transparent);
}

/* 卡片内容 */
.stat-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

/* 数值 */
.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

/* 标签 */
.stat-label {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-3);
  font-weight: 500;
}

/* 图标 */
.stat-icon {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--stat-color);
  background: color-mix(in srgb, var(--stat-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--stat-color) 20%, transparent);
  transition:
    background var(--dur-2) var(--ease-out),
    border-color var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
}

/* 悬停时图标轻微缩放 */
.stat-card--clickable:hover .stat-icon {
  transform: scale(1.05);
}
</style>

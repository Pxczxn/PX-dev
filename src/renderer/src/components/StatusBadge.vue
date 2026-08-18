<script setup lang="ts">
// PX Dev — StatusBadge 组件
// 状态徽章，根据进程状态显示不同颜色和动画
// - running/starting: 绿色脉冲点 + 运行时长
// - failed: 红色，hover tooltip 显示最近错误 + 「查看日志 →」按钮（无论是否有错误文本）
// - stopped/exited: 灰色静态

import { computed, ref, onMounted, onUnmounted } from 'vue'
import { NTooltip, NButton } from 'naive-ui'
import { useRouter } from 'vue-router'
import { STATUS_CONFIG } from '@shared/constants/status'
import type { ProcessStatus } from '@shared/types'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'

const props = defineProps<{
  status: ProcessStatus
  serviceId?: string
}>()

const router = useRouter()

// 根据状态获取配置（颜色、标签文本）
const config = computed(() => STATUS_CONFIG[props.status] ?? STATUS_CONFIG.unknown)
const isLive = computed(() => props.status === 'running' || props.status === 'starting')
const isFailed = computed(() => props.status === 'failed')
const isRunning = computed(() => props.status === 'running')

const runtimeStore = useRuntimeStore()

// ===== 运行时长（每秒更新）=====
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 只对 running 状态启动计时器
  if (isRunning.value) {
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

/** 根据 startedAt 计算运行时长字符串，如 "1h 23m"、"5m 30s"、"12s" */
const uptime = computed(() => {
  if (!props.serviceId || !isRunning.value) return ''
  const rt = runtimeStore.getRuntime(props.serviceId)
  if (!rt?.startedAt) return ''
  const elapsed = Math.floor((now.value - rt.startedAt) / 1000)
  if (elapsed < 0) return ''
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
})

// ===== 失败错误信息（取 runtime.error，只显示第一行并去掉标准前缀）=====
/** 去掉常见的 Error 前缀，只保留有意义的错误描述 */
function stripErrorPrefix(text: string): string {
  // 去掉 "Error [ERR_XXX]: " 或 "Error: " 前缀
  return text.replace(/^Error\s*(?:\[[^\]]+\])?\s*:\s*/, '')
}

const lastError = computed(() => {
  if (!props.serviceId || !isFailed.value) return ''
  const rt = runtimeStore.getRuntime(props.serviceId)
  if (!rt?.error) return ''
  const first = rt.error.split('\n')[0].trimEnd()
  return stripErrorPrefix(first)
})

/** 跳转到日志页面 */
function goToLogs(): void {
  if (props.serviceId) {
    router.push({ path: '/logs', query: { service: props.serviceId } })
  }
}
</script>

<template>
  <!-- ===== 失败状态（无论有没有错误文本，都显示 tooltip）=====
       有错误 → 显示错误 + 查看日志按钮
       无错误 → 仅显示查看日志按钮 -->
  <NTooltip v-if="isFailed && serviceId" trigger="hover" :delay="300">
    <template #trigger>
      <span class="status-badge" :style="{ '--badge-color': config.color }">
        <span class="badge-dot" :class="{ pulse: isLive }" />
        <span class="badge-label">{{ config.label }}</span>
      </span>
    </template>
    <div class="error-tooltip">
      <div v-if="lastError" class="error-tooltip-title">最近错误</div>
      <div v-if="lastError" class="error-tooltip-text">{{ lastError }}</div>
      <NButton size="tiny" quaternary class="log-link" @click="goToLogs">
        查看日志 →
      </NButton>
    </div>
  </NTooltip>

  <!-- ===== 运行中：显示运行时长 tooltip ===== -->
  <NTooltip v-else-if="isRunning && uptime" trigger="hover" :delay="300">
    <template #trigger>
      <span class="status-badge" :style="{ '--badge-color': config.color }">
        <span class="badge-dot pulse" />
        <span class="badge-label">{{ config.label }}</span>
        <!-- 徽章右侧内嵌时长 -->
        <span class="badge-uptime">{{ uptime }}</span>
      </span>
    </template>
    <div class="uptime-tooltip">
      <div class="uptime-tooltip-title">运行时长</div>
      <div class="uptime-tooltip-text">{{ uptime }}</div>
    </div>
  </NTooltip>

  <!-- ===== 其他状态：纯徽章无 tooltip ===== -->
  <span v-else class="status-badge" :style="{ '--badge-color': config.color }">
    <span class="badge-dot" :class="{ pulse: isLive }" />
    <span class="badge-label">{{ config.label }}</span>
  </span>
</template>

<style scoped>
/* ===== 徽章主体 ===== */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 4px;
  border-radius: var(--r-full);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: var(--badge-color);
  background: color-mix(in srgb, var(--badge-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--badge-color) 25%, transparent);
  white-space: nowrap;
}

/* ===== 状态圆点 ===== */
.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--badge-color);
  flex-shrink: 0;
}

/* 脉冲动画（running/starting 时） */
.badge-dot.pulse {
  animation: badge-pulse 1.6s var(--ease-out) infinite;
}

@keyframes badge-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--badge-color) 55%, transparent); }
  70%  { box-shadow: 0 0 0 4px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

/* ===== 运行时长（徽章右侧内嵌显示） ===== */
.badge-uptime {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.75;
  font-family: var(--font-mono);
}

/* ===== 运行时长 tooltip ===== */
.uptime-tooltip {
  max-width: 200px;
}

.uptime-tooltip-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 4px;
}

.uptime-tooltip-text {
  font-size: 14px;
  font-family: var(--font-mono);
  color: var(--accent);
  font-weight: 600;
}

/* ===== 错误 tooltip ===== */
.error-tooltip {
  max-width: 360px;
}

.error-tooltip-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 4px;
}

.error-tooltip-text {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-3);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.5;
}

.log-link {
  margin-top: 8px;
  color: var(--accent) !important;
  padding: 0 !important;
  font-size: 12px !important;
}
</style>

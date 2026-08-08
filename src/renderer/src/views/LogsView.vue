<script setup lang="ts">
// PX Dev — LogsView
// Multi-tab log viewer with search, clear, copy, export; stderr highlighted

import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import {
  NTabs,
  NTabPane,
  NInput,
  NButton,
  NSpace,
  NScrollbar,
  NEmpty,
  useMessage,
} from 'naive-ui'
import { CopyOutline, TrashOutline, DownloadOutline, SearchOutline } from '@vicons/ionicons5'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useLogStore } from '@renderer/stores/logStore'
import { useLogStream } from '@renderer/composables/useLogStream'
import { api } from '@renderer/api'

const message = useMessage()
const workspaceStore = useWorkspaceStore()
const logStore = useLogStore()

const activeServiceId = ref<string | null>(null)
const searchText = ref('')
const scrollbarRef = ref<InstanceType<typeof NScrollbar> | null>(null)

// Subscribe to active service's log stream (side-effect: IPC subscription)
useLogStream(activeServiceId)

// Services that can have logs (all services)
const services = computed(() => workspaceStore.services)

// Current logs
const currentLogs = computed(() => {
  if (!activeServiceId.value) return []
  const logs = logStore.getLogs(activeServiceId.value)
  if (!searchText.value) return logs
  return logs.filter((e) => e.text.includes(searchText.value))
})

// Auto-scroll to bottom on new logs
watch(
  () => currentLogs.value.length,
  async () => {
    await nextTick()
    scrollbarRef.value?.scrollTo({ top: 999999, behavior: 'smooth' })
  },
)

onMounted(async () => {
  await workspaceStore.fetchServices()
  logStore.startListening()

  // Auto-select first service
  if (services.value.length > 0) {
    activeServiceId.value = services.value[0].id
  }
})

onUnmounted(() => {
  if (activeServiceId.value) {
    logStore.unsubscribe(activeServiceId.value)
  }
})

function handleTabChange(key: string): void {
  activeServiceId.value = key
}

async function clearLogs(): Promise<void> {
  if (!activeServiceId.value) return
  try {
    await api.log.clear(activeServiceId.value)
    logStore.clearLogs(activeServiceId.value)
    message.success('日志已清空')
  } catch (err) {
    message.error('清空失败')
    console.error(err)
  }
}

async function copyLogs(): Promise<void> {
  if (!activeServiceId.value) return
  const logs = logStore.getLogs(activeServiceId.value)
  const text = logs
    .map((e) => `[${new Date(e.timestamp).toISOString()}] [${e.stream}] ${e.text}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败')
  }
}

async function exportLogs(): Promise<void> {
  if (!activeServiceId.value) return
  try {
    const result = await api.log.export(activeServiceId.value)
    if (result.success) {
      message.success('日志已导出')
    }
  } catch (err) {
    message.error('导出失败')
    console.error(err)
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
</script>

<template>
  <div class="page-container log-page">
    <div class="page-header">
      <h2 class="page-title">日志</h2>
    </div>

    <div v-if="services.length === 0" class="empty-logs">
      <NEmpty description="暂无服务，请先创建服务" />
    </div>

    <div v-else class="log-container">
      <!-- Toolbar -->
      <div class="log-toolbar">
        <NInput
          v-model:value="searchText"
          placeholder="搜索日志..."
          size="small"
          clearable
          style="width: 240px;"
        >
          <template #prefix><SearchOutline /></template>
        </NInput>
        <NSpace size="small">
          <NButton size="small" quaternary @click="copyLogs" :disabled="!activeServiceId">
            <template #icon><CopyOutline /></template>
            复制
          </NButton>
          <NButton size="small" quaternary @click="clearLogs" :disabled="!activeServiceId">
            <template #icon><TrashOutline /></template>
            清空
          </NButton>
          <NButton size="small" quaternary @click="exportLogs" :disabled="!activeServiceId">
            <template #icon><DownloadOutline /></template>
            导出
          </NButton>
        </NSpace>
      </div>

      <!-- Tabs -->
      <NTabs
        type="card"
        size="small"
        :value="activeServiceId ?? undefined"
        @update:value="handleTabChange"
        class="log-tabs"
      >
        <NTabPane
          v-for="svc in services"
          :key="svc.id"
          :name="svc.id"
          :tab="svc.name"
        >
          <NScrollbar ref="scrollbarRef" class="log-scroll" :style="{ maxHeight: 'calc(100vh - 280px)' }">
            <div v-if="currentLogs.length === 0" class="log-empty">
              <NEmpty size="small" description="暂无日志" />
            </div>
            <div v-else class="log-content">
              <div
                v-for="(entry, idx) in currentLogs"
                :key="idx"
                class="log-line"
                :class="{ 'log-stderr': entry.stream === 'stderr' }"
              >
                <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
                <span class="log-stream" :class="{ 'stream-err': entry.stream === 'stderr' }">
                  {{ entry.stream === 'stderr' ? 'ERR' : 'OUT' }}
                </span>
                <span class="log-text">{{ entry.text }}</span>
              </div>
            </div>
          </NScrollbar>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>

<style scoped>
.log-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.empty-logs {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.log-container {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.log-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.log-scroll {
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  padding: var(--sp-2);
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.log-content {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.log-line {
  display: flex;
  gap: var(--sp-2);
  padding: 1px 4px;
  border-radius: 2px;
}

.log-line:hover {
  background: var(--bg-hover);
}

.log-stderr {
  background: color-mix(in srgb, var(--c-failed) 10%, transparent);
}

.log-time {
  color: var(--text-4);
  flex-shrink: 0;
  white-space: nowrap;
}

.log-stream {
  color: var(--accent);
  flex-shrink: 0;
  width: 32px;
}

.stream-err {
  color: var(--c-failed);
}

.log-text {
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

<script setup lang="ts">
// PX Dev — LogsView
// Multi-tab log viewer with search, clear, copy, export; stderr highlighted
// Optimized: route query pre-select, log count badges, auto-scroll toggle

import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import {
  NTabs,
  NTabPane,
  NInput,
  NButton,
  NSpace,
  NScrollbar,
  NEmpty,
  NBadge,
  useMessage,
  NVirtualList,
} from 'naive-ui'
import {
  CopyOutline,
  TrashOutline,
  DownloadOutline,
  SearchOutline,
  ArrowDownOutline,
  PauseOutline,
} from '@vicons/ionicons5'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useLogStore } from '@renderer/stores/logStore'
import { useLogStream } from '@renderer/composables/useLogStream'
import { api } from '@renderer/api'
import { logger } from '@renderer/utils/logger'

const route = useRoute()
const message = useMessage()
const workspaceStore = useWorkspaceStore()
const logStore = useLogStore()

const activeServiceId = ref<string | null>(null)
const searchText = ref('')
const scrollbarRef = ref<InstanceType<typeof NScrollbar> | null>(null)
const autoScroll = ref(true)

useLogStream(activeServiceId)

const services = computed(() => workspaceStore.services)

const currentLogs = computed(() => {
  if (!activeServiceId.value) return []
  const logs = logStore.getLogs(activeServiceId.value)
  if (!searchText.value) return logs
  return logs.filter((e) => e.text.includes(searchText.value))
})

function getLogCount(serviceId: string): number {
  return logStore.getLogs(serviceId).length
}

function getErrorCount(serviceId: string): number {
  return logStore.getLogs(serviceId).filter((e) => e.stream === 'stderr').length
}

watch(
  () => currentLogs.value.length,
  async () => {
    if (!autoScroll.value) return
    await nextTick()
    scrollbarRef.value?.scrollTo({ top: 999999, behavior: 'smooth' })
  },
)

onMounted(async () => {
  await workspaceStore.fetchServices()
  logStore.startListening()

  const queryService = route.query.service as string | undefined
  if (queryService && services.value.some((s) => s.id === queryService)) {
    activeServiceId.value = queryService
  } else if (services.value.length > 0) {
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

function scrollToBottom(): void {
  scrollbarRef.value?.scrollTo({ top: 999999, behavior: 'smooth' })
  autoScroll.value = true
}

function toggleAutoScroll(): void {
  autoScroll.value = !autoScroll.value
  if (autoScroll.value) {
    scrollToBottom()
  }
}

async function clearLogs(): Promise<void> {
  if (!activeServiceId.value) return
  try {
    await api.log.clear(activeServiceId.value)
    logStore.clearLogs(activeServiceId.value)
    message.success('日志已清空')
  } catch (err) {
    logger.error('LogsView', 'Failed to clear logs', err)
    message.error('清空失败')
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
    logger.error('LogsView', 'Failed to export logs', err)
    message.error('导出失败')
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
        <NSpace size="small" align="center">
          <span class="log-count-label" v-if="activeServiceId">
            共 {{ currentLogs.length }} 条
            <span v-if="currentLogs.filter(e => e.stream === 'stderr').length > 0" class="error-count">
              / {{ currentLogs.filter(e => e.stream === 'stderr').length }} 条错误
            </span>
          </span>
          <NButton
            size="small"
            quaternary
            :type="autoScroll ? 'primary' : 'default'"
            @click="toggleAutoScroll"
          >
            <template #icon><ArrowDownOutline v-if="!autoScroll" /><PauseOutline v-else /></template>
            {{ autoScroll ? '自动滚动中' : '已暂停' }}
          </NButton>
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
        >
          <template #tab>
            <span class="tab-label">
              {{ svc.name }}
              <NBadge
                v-if="getErrorCount(svc.id) > 0"
                :value="getErrorCount(svc.id)"
                type="error"
                :offset="[6, -2]"
              />
              <NBadge
                v-else-if="getLogCount(svc.id) > 0"
                :value="getLogCount(svc.id)"
                type="info"
                :offset="[6, -2]"
              />
            </span>
          </template>
          <NScrollbar
            ref="scrollbarRef"
            class="log-scroll"
            :style="{ maxHeight: 'calc(100vh - 280px)' }"
          >
            <div v-if="currentLogs.length === 0" class="log-empty">
              <NEmpty size="small" description="暂无日志" />
            </div>
            <NVirtualList
              v-else
              :items="currentLogs"
              :item-size="28"
              :item-resizable="true"
              class="log-content"
            >
              <template #default="{ item: entry }">
                <div
                  class="log-line"
                  :class="{ 'log-stderr': entry.stream === 'stderr' }"
                >
                  <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
                  <span class="log-stream" :class="{ 'stream-err': entry.stream === 'stderr' }">
                    {{ entry.stream === 'stderr' ? 'ERR' : 'OUT' }}
                  </span>
                  <span class="log-text">{{ entry.text }}</span>
                </div>
              </template>
            </NVirtualList>
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

.log-count-label {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}

.error-count {
  color: var(--c-failed);
  font-weight: 600;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  line-height: 1.8;
}

.log-line {
  display: flex;
  gap: var(--sp-2);
  padding: 3px 6px;
  border-radius: 2px;
  transition: background var(--dur-1) var(--ease-out);
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

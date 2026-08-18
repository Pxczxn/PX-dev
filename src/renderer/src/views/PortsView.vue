<script setup lang="ts">
// PX Dev — PortsView
// 端口监控面板：手动检测 + 常用端口列表

import { onMounted, ref, h } from 'vue'
import {
  NCard,
  NButton,
  NSpace,
  NInputNumber,
  NTag,
  NDataTable,
  NPopconfirm,
  NSpin,
  useMessage,
} from 'naive-ui'
import { RefreshOutline, SearchOutline, CloseCircleOutline } from '@vicons/ionicons5'
import { usePortStore } from '@renderer/stores/portStore'
import type { PortOwner } from '@shared/types'

interface PortCheckResult {
  port: number
  available: boolean
  owner: PortOwner | null
}

const message = useMessage()
const portStore = usePortStore()
const manualPort = ref<number | null>(null)

onMounted(() => {
  portStore.checkCommonPorts()
})

const columns = [
  {
    title: '端口',
    key: 'port',
    width: 100,
    render: (row: PortCheckResult) =>
      h('span', { class: 'mono' }, String(row.port)),
  },
  {
    title: '状态',
    key: 'available',
    width: 100,
    render: (row: PortCheckResult) =>
      h(
        NTag,
        { size: 'small', type: row.available ? 'success' : 'warning', bordered: false },
        { default: () => (row.available ? '空闲' : '占用') },
      ),
  },
  {
    title: '占用进程',
    key: 'owner',
    render: (row: PortCheckResult) => {
      if (!row.owner) return h('span', { style: 'color: var(--text-4);' }, '—')
      return h('span', null, `${row.owner.name} (PID: ${row.owner.pid})`)
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row: PortCheckResult) => {
      if (row.available || !row.owner) return null
      return h(
        NPopconfirm,
        {
          onPositiveClick: () => portStore.killProcess(row.owner!.pid),
        },
        {
          trigger: () =>
            h(
              NButton,
              { size: 'small', type: 'error', quaternary: true },
              { default: () => '终止' },
            ),
          default: () => `确认终止进程 ${row.owner?.name} (PID: ${row.owner?.pid})？`,
        },
      )
    },
  },
]
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">端口</h2>
        <p class="page-subtitle">检测常用端口状态，快速定位冲突进程</p>
      </div>
      <NButton @click="portStore.checkCommonPorts()" :loading="portStore.checking">
        <template #icon><RefreshOutline /></template>
        刷新
      </NButton>
    </div>

    <!-- 手动检测 -->
    <NCard title="手动检测" size="small" :bordered="false" class="port-card">
      <NSpace>
        <NInputNumber
          v-model:value="manualPort"
          placeholder="输入端口号"
          :min="1"
          :max="65535"
          style="width: 200px"
        />
        <NButton
          type="primary"
          :disabled="!manualPort"
          @click="async () => {
            if (manualPort) {
              const result = await portStore.checkPort(manualPort)
              message.info(`端口 ${result.port} ${result.available ? '空闲' : '被占用'}`)
            }
          }"
        >
          <template #icon><SearchOutline /></template>
          检测
        </NButton>
      </NSpace>
    </NCard>

    <!-- 常用端口表格 -->
    <NCard title="常用端口" size="small" :bordered="false" class="port-card" style="margin-top: 16px;">
      <NSpin :show="portStore.checking">
        <NDataTable
          :columns="columns"
          :data="portStore.results"
          :bordered="false"
          size="small"
          :row-class-name="() => 'port-table-row'"
        />
      </NSpin>
    </NCard>
  </div>
</template>

<style scoped>
/* 副标题 */
.page-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

/* 端口卡片 */
.port-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  transition:
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}

.port-card:hover {
  border-color: var(--border-default);
  box-shadow: var(--glow-sm);
}

/* 表格行悬停 */
:deep(.port-table-row:hover) {
  background: var(--bg-hover) !important;
}
</style>

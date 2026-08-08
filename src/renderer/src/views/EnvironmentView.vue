<script setup lang="ts">
// PX Dev — EnvironmentView
// 8 environment detection table + re-detect

import { onMounted, h } from 'vue'
import {
  NCard,
  NButton,
  NDataTable,
  NTag,
  NSpin,
  useMessage,
} from 'naive-ui'
import { RefreshOutline } from '@vicons/ionicons5'
import { useEnvironmentStore } from '@renderer/stores/environmentStore'
import type { EnvironmentInfo } from '@shared/types'

const message = useMessage()
const envStore = useEnvironmentStore()

onMounted(() => {
  envStore.detectAll()
})

const columns = [
  {
    title: '环境',
    key: 'name',
    width: 120,
    render: (row: EnvironmentInfo) =>
      h('span', { class: 'mono' }, row.name),
  },
  {
    title: '状态',
    key: 'available',
    width: 100,
    render: (row: EnvironmentInfo) =>
      h(
        NTag,
        { size: 'small', type: row.available ? 'success' : 'error', bordered: false },
        { default: () => (row.available ? '可用' : '未安装') },
      ),
  },
  {
    title: '版本',
    key: 'version',
    render: (row: EnvironmentInfo) => row.version || '—',
  },
  {
    title: '路径',
    key: 'path',
    render: (row: EnvironmentInfo) =>
      h('span', { class: 'mono', style: 'font-size: 12px; color: var(--text-3);' }, row.path || '—'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row: EnvironmentInfo) =>
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          onClick: () => reDetect(row.name),
        },
        { default: () => h('span', '重新检测') },
      ),
  },
]

async function reDetect(name: string): Promise<void> {
  try {
    await envStore.detectSingle(name as never)
    message.success(`${name} 重新检测完成`)
  } catch {
    message.error(`${name} 检测失败`)
  }
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">环境</h2>
      <NButton @click="envStore.detectAll()" :loading="envStore.loading">
        <template #icon><RefreshOutline /></template>
        全部重新检测
      </NButton>
    </div>

    <NSpin :show="envStore.loading">
      <NCard size="small" :bordered="false" class="table-card">
        <NDataTable
          :columns="columns"
          :data="envStore.environments"
          :bordered="false"
          size="small"
        >
          <template #empty>
            <div style="padding: 40px; text-align: center; color: var(--text-4);">
              点击"全部重新检测"来检测开发环境
            </div>
          </template>
        </NDataTable>
      </NCard>
    </NSpin>
  </div>
</template>


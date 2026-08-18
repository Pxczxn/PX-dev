<script setup lang="ts">
// PX Dev — EnvironmentView
// 环境检测面板：检测 node/npm/pnpm/yarn/java/mvn/gradle/git

import { onMounted, h } from 'vue'
import {
  NButton,
  NTag,
  NDataTable,
  NSpin,
  NIcon,
} from 'naive-ui'
import {
  RefreshOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline,
} from '@vicons/ionicons5'
import { useEnvironmentStore } from '@renderer/stores/environmentStore'
import type { EnvironmentInfo } from '@shared/types'

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
      h('span', { style: 'font-weight: 600; letter-spacing: 0.05em;' }, row.name),
  },
  {
    title: '状态',
    key: 'available',
    width: 120,
    render: (row: EnvironmentInfo) =>
      h(
        NTag,
        {
          size: 'small',
          type: row.available ? 'success' : 'error',
          bordered: false,
          style: 'font-weight: 500;',
        },
        {
          default: () => (row.available ? '已安装' : '未安装'),
          icon: () =>
            h(NIcon, null, {
              default: () =>
                h(row.available ? CheckmarkCircleOutline : CloseCircleOutline, {
                  style: 'margin-right: 4px;',
                }),
            }),
        },
      ),
  },
  {
    title: '版本',
    key: 'version',
    width: 180,
    render: (row: EnvironmentInfo) =>
      row.available
        ? h('span', { class: 'mono' }, row.version || '—')
        : h('span', { style: 'color: var(--text-4);' }, '—'),
  },
  {
    title: '路径',
    key: 'path',
    render: (row: EnvironmentInfo) =>
      row.available && row.path
        ? h('span', { class: 'mono env-path', style: 'font-size: 12px;' }, row.path)
        : h('span', { style: 'color: var(--text-4);' }, '—'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render: (row: EnvironmentInfo) =>
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          type: 'primary',
          loading: envStore.loading,
          onClick: () => envStore.detectSingle(row.name as any),
        },
        { default: () => '重新检测' },
      ),
  },
]
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">环境</h2>
        <p class="page-subtitle">检测本地开发工具是否已安装及版本信息</p>
      </div>
      <NButton type="primary" :loading="envStore.loading" @click="envStore.detectAll()">
        <template #icon><RefreshOutline /></template>
        全部重新检测
      </NButton>
    </div>

    <div class="env-card">
      <NSpin :show="envStore.loading && envStore.environments.length === 0">
        <NDataTable
          v-if="envStore.environments.length > 0"
          :columns="columns"
          :data="envStore.environments"
          :bordered="false"
          :single-line="false"
          size="small"
          :row-class-name="() => 'env-table-row'"
        />
        <div v-else-if="!envStore.loading" class="empty-hint">
          点击「全部重新检测」来检测开发环境
        </div>
      </NSpin>
    </div>
  </div>
</template>

<style scoped>
/* 副标题 */
.page-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

/* 环境卡片 */
.env-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  padding: 4px;
  overflow: hidden;
  transition:
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}

.env-card:hover {
  border-color: var(--border-default);
  box-shadow: var(--glow-sm);
}

.empty-hint {
  padding: 80px 0;
  text-align: center;
  color: var(--text-4);
  font-size: 14px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-ligatures: contextual;
}

.env-path {
  display: block;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 表格行悬停效果 */
:deep(.env-table-row:hover) {
  background: var(--bg-hover) !important;
}
</style>

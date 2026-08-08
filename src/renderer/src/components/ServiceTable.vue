<script setup lang="ts">
// PX Dev — ServiceTable Component
// Shared service list table with start/stop/restart/forceKill actions

import { computed, h } from 'vue'
import {
  NDataTable,
  NButton,
  NButtonGroup,
  NTooltip,
  NPopconfirm,
  NIcon,
} from 'naive-ui'
import { PlayOutline, StopOutline, RefreshOutline, TrashOutline, CreateOutline } from '@vicons/ionicons5'
import StatusBadge from './StatusBadge.vue'
import { useService } from '@renderer/composables/useService'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import type { Service, ProcessStatus, ProcessRuntime } from '@shared/types'

interface TableRow {
  service: Service
  runtime?: ProcessRuntime
}

const props = defineProps<{
  services: Service[]
}>()

const emit = defineEmits<{
  edit: [service: Service]
  delete: [service: Service]
}>()

const runtimeStore = useRuntimeStore()
const { startService, stopService, restartService, isOperating } = useService()

// Build display rows with runtime info
const tableData = computed(() =>
  props.services.map((svc) => ({
    service: svc,
    runtime: runtimeStore.getRuntime(svc.id),
  })),
)

const columns = [
  {
    title: '服务名',
    key: 'name',
    render: (row: TableRow) =>
      h('span', { style: { fontWeight: '500' } }, row.service.name),
  },
  {
    title: '状态',
    key: 'status',
    width: 120,
    render: (row: TableRow) =>
      h(StatusBadge, {
        status: (row.runtime?.status ?? 'stopped') as ProcessStatus,
      }),
  },
  {
    title: '端口',
    key: 'port',
    width: 80,
    render: (row: TableRow) =>
      row.service.port ? h('span', { class: 'mono' }, String(row.service.port)) : h('span', { style: { color: 'var(--text-4)' } }, '—'),
  },
  {
    title: '命令',
    key: 'command',
    render: (row: TableRow) =>
      h('span', { class: 'mono', style: { fontSize: '12px', color: 'var(--text-3)' } },
        `${row.service.command} ${(row.service.args ?? []).join(' ')}`,
      ),
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row: TableRow) => {
      const svc = row.service
      const rt = runtimeStore.getRuntime(svc.id)
      const isRunning = rt?.status === 'running' || rt?.status === 'starting'
      const op = isOperating(svc.id)

      return h(NButtonGroup, { size: 'small' }, () => [
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  quaternary: true,
                  circle: true,
                  loading: op,
                  disabled: isRunning,
                  onClick: () => startService(svc),
                },
                { default: () => h(NIcon, null, { default: () => h(PlayOutline) }) },
              ),
            default: () => '启动',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  quaternary: true,
                  circle: true,
                  loading: op,
                  disabled: !isRunning,
                  onClick: () => stopService(svc),
                },
                { default: () => h(NIcon, null, { default: () => h(StopOutline) }) },
              ),
            default: () => '停止',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  quaternary: true,
                  circle: true,
                  loading: op,
                  disabled: !isRunning,
                  onClick: () => restartService(svc),
                },
                { default: () => h(NIcon, null, { default: () => h(RefreshOutline) }) },
              ),
            default: () => '重启',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  quaternary: true,
                  circle: true,
                  onClick: () => emit('edit', svc),
                },
                { default: () => h(NIcon, null, { default: () => h(CreateOutline) }) },
              ),
            default: () => '编辑',
          },
        ),
        h(
          NPopconfirm,
          {
            onPositiveClick: () => emit('delete', svc),
          },
          {
            trigger: () =>
              h(
                NButton,
                {
                  quaternary: true,
                  circle: true,
                  type: 'error',
                },
                { default: () => h(NIcon, null, { default: () => h(TrashOutline) }) },
              ),
            default: () => `确认删除服务 "${svc.name}"？`,
          },
        ),
      ])
    },
  },
]
</script>

<template>
  <NDataTable
    :columns="columns"
    :data="tableData"
    :bordered="false"
    :single-line="false"
    size="small"
  />
</template>

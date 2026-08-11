<script setup lang="ts">
// PX Dev — ServiceTable Component
// Shared service list table with start/stop/restart/forceKill actions
// Phase 6 新增：Local URL 快捷入口 + 端口冲突提示
// Phase 7 新增：按工作区/项目二级分组显示 + 批量删除

import { computed, h, ref } from 'vue'
import {
  NDataTable,
  NButton,
  NButtonGroup,
  NTooltip,
  NPopconfirm,
  NIcon,
  NText,
  NCheckbox,
  NModal,
  useMessage,
} from 'naive-ui'
import { PlayOutline, StopOutline, RefreshOutline, TrashOutline, CreateOutline, LinkOutline, TrashBinOutline } from '@vicons/ionicons5'
import StatusBadge from './StatusBadge.vue'
import { useService } from '@renderer/composables/useService'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { api } from '@renderer/api'
import type { Service, ProcessStatus, ProcessRuntime, Workspace } from '@shared/types'
import { formatIpcError } from '@renderer/api/errors'

interface TableRow {
  service: Service
  runtime?: ProcessRuntime
  indent: number
}

interface WorkspaceGroupHeaderRow {
  type: 'workspace-header'
  workspace: Workspace
  projectCount: number
  serviceCount: number
  runningCount: number
  indent: number
}

interface ProjectHeaderRow {
  type: 'project-header'
  projectName: string
  serviceCount: number
  runningCount: number
  indent: number
}

interface TypeHeaderRow {
  type: 'type-header'
  serviceType: 'frontend' | 'backend' | 'other'
  serviceCount: number
  runningCount: number
  indent: number
}

type DataTableRow = TableRow | ProjectHeaderRow | WorkspaceGroupHeaderRow | TypeHeaderRow

// 从 cwd 提取项目名（相对于 workspace root 的第一层目录）
function extractProjectName(cwd: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return 'root'
  // 规范化路径（处理 Windows 反斜杠）
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')

  // cwd 正好是 workspace root
  if (normalizedCwd === normalizedRoot || normalizedCwd === normalizedRoot.replace(/^\w:/, '')) {
    return 'root'
  }

  // 计算相对路径
  const relative = normalizedCwd.replace(new RegExp(`^${normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').replace(/^\/+/, '')
  const segments = relative.split('/').filter(Boolean)
  return segments[0] || 'root'
}

// 获取服务类型标签
function getServiceTypeLabel(type: Service['type']): string {
  switch (type) {
    case 'frontend': return '前端'
    case 'node': return 'Node'
    case 'java': return 'Java'
    default: return '通用'
  }
}

// 获取服务类型颜色
function getServiceTypeColor(type: Service['type']): string {
  switch (type) {
    case 'frontend': return 'var(--accent)'
    case 'node': return '#52c41a'
    case 'java': return '#fa8c16'
    default: return 'var(--text-3)'
  }
}

const props = defineProps<{
  services: Service[]
  workspaces?: Workspace[]
}>()

const emit = defineEmits<{
  edit: [service: Service]
  delete: [service: Service]
  'batch-delete': [serviceIds: string[]]
}>()

const runtimeStore = useRuntimeStore()
const { startService, stopService, restartService, isOperating } = useService()
const message = useMessage()

// ============ Batch Selection for Bulk Delete ============
const selectedServiceIds = ref<Set<string>>(new Set())
const showBatchDeleteModal = ref(false)
const batchDeleting = ref(false)

/** Toggle selection of a single service */
function toggleSelection(serviceId: string, checked: boolean): void {
  if (checked) {
    selectedServiceIds.value.add(serviceId)
  } else {
    selectedServiceIds.value.delete(serviceId)
  }
}

/** Toggle select all (only for service rows, not headers) */
function toggleSelectAll(checked: boolean): void {
  if (checked) {
    for (const row of tableData.value) {
      if ('service' in row && row.service) {
        selectedServiceIds.value.add(row.service.id)
      }
    }
  } else {
    selectedServiceIds.value.clear()
  }
}

/** Check if a service is selected */
function isSelected(serviceId: string): boolean {
  return selectedServiceIds.value.has(serviceId)
}

/** Check if all service rows are selected */
const isAllSelected = computed(() => {
  const serviceRows = tableData.value.filter((r) => 'service' in r && r.service)
  if (serviceRows.length === 0) return false
  return serviceRows.every((r) => 'service' in r && selectedServiceIds.value.has(r.service!.id))
})

/** Check if some (but not all) service rows are selected */
const isIndeterminate = computed(() => {
  const serviceRows = tableData.value.filter((r) => 'service' in r && r.service)
  if (serviceRows.length === 0) return false
  const selectedCount = serviceRows.filter((r) => 'service' in r && selectedServiceIds.value.has(r.service!.id)).length
  return selectedCount > 0 && selectedCount < serviceRows.length
})

/** Open batch delete confirmation */
function openBatchDeleteModal(): void {
  if (selectedServiceIds.value.size === 0) return
  showBatchDeleteModal.value = true
}

/** Perform batch delete (hard delete: stop + remove) */
async function performBatchDelete(): Promise<void> {
  batchDeleting.value = true
  const idsToDelete = Array.from(selectedServiceIds.value)
  const servicesToDelete = props.services.filter((s) => idsToDelete.includes(s.id))

  try {
    // Stop all running services first
    for (const svc of servicesToDelete) {
      const runtime = runtimeStore.getRuntime(svc.id)
      if (runtime?.status === 'running' || runtime?.status === 'starting') {
        try {
          await api.process.stop(svc.id)
        } catch {
          // Force kill if normal stop fails
          await api.process.forceKill(svc.id)
        }
      }
    }

    // Delete each service
    for (const id of idsToDelete) {
      await api.service.delete(id)
    }

    message.success(`已删除 ${idsToDelete.length} 个服务`)
    selectedServiceIds.value.clear()
    showBatchDeleteModal.value = false
    emit('batch-delete', idsToDelete)
  } catch (err) {
    message.error(formatIpcError(err, '批量删除失败'))
  } finally {
    batchDeleting.value = false
  }
}

// Expose for parent component to control batch selection
defineExpose({
  selectedCount: computed(() => selectedServiceIds.value.size),
  clearSelection: () => selectedServiceIds.value.clear(),
  openBatchDeleteModal: () => {
    if (selectedServiceIds.value.size > 0) {
      showBatchDeleteModal.value = true
    }
  },
})

// Build display rows with runtime info
const tableData = computed(() => {
  // No grouping needed - return flat service list
  if (!props.workspaces || props.workspaces.length === 0) {
    return props.services.map((svc) => ({
      service: svc,
      runtime: runtimeStore.getRuntime(svc.id),
    }))
  }

  // Build workspace lookup map
  const workspaceMap = new Map(props.workspaces.map(w => [w.id, w]))

  // Group services by workspace -> project -> type (frontend/backend)
  type ServiceType = 'frontend' | 'backend' | 'other'
  const servicesByWorkspace = new Map<string, Map<string, Map<ServiceType, Service[]>>>()

  for (const svc of props.services) {
    const workspace = workspaceMap.get(svc.workspaceId)
    if (!workspace) continue

    // Extract project name from cwd relative to workspace root
    const projectName = extractProjectName(svc.cwd, workspace.rootPath)

    const serviceType: ServiceType =
      svc.type === 'frontend' ? 'frontend' :
      (svc.type === 'node' || svc.type === 'java') ? 'backend' : 'other'

    if (!servicesByWorkspace.has(svc.workspaceId)) {
      servicesByWorkspace.set(svc.workspaceId, new Map())
    }
    const projectMap = servicesByWorkspace.get(svc.workspaceId)!

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, new Map())
    }
    const typeMap = projectMap.get(projectName)!

    if (!typeMap.has(serviceType)) {
      typeMap.set(serviceType, [])
    }
    typeMap.get(serviceType)!.push(svc)
  }

  const rows: DataTableRow[] = []

  for (const [workspaceId, projectMap] of servicesByWorkspace) {
    const workspace = workspaceMap.get(workspaceId)
    if (!workspace) continue

    // Calculate workspace-level stats
    let workspaceServiceCount = 0
    let workspaceRunningCount = 0
    for (const typeMap of projectMap.values()) {
      for (const services of typeMap.values()) {
        workspaceServiceCount += services.length
        workspaceRunningCount += services.filter(s => {
          const rt = runtimeStore.getRuntime(s.id)
          return rt?.status === 'running' || rt?.status === 'starting'
        }).length
      }
    }

    // Check if there's only one "root" project (all services at workspace root)
    const hasOnlyRootProject = projectMap.size === 1 && projectMap.has('root')

    // Workspace header
    rows.push({
      type: 'workspace-header',
      workspace,
      projectCount: projectMap.size,
      serviceCount: workspaceServiceCount,
      runningCount: workspaceRunningCount,
      indent: 0,
    })

    // Sort projects: "root" first, then alphabetically
    const sortedProjects = Array.from(projectMap.entries()).sort(([a], [b]) => {
      if (a === 'root') return -1
      if (b === 'root') return 1
      return a.localeCompare(b)
    })

    // Project headers -> Type headers -> Services
    for (const [projectName, typeMap] of sortedProjects) {
      // Calculate project-level stats
      let projectServiceCount = 0
      let projectRunningCount = 0
      for (const services of typeMap.values()) {
        projectServiceCount += services.length
        projectRunningCount += services.filter(s => {
          const rt = runtimeStore.getRuntime(s.id)
          return rt?.status === 'running' || rt?.status === 'starting'
        }).length
      }

      const showProjectHeader = !hasOnlyRootProject || projectName !== 'root'
      if (showProjectHeader) {
        rows.push({
          type: 'project-header',
          projectName,
          serviceCount: projectServiceCount,
          runningCount: projectRunningCount,
          indent: 1,
        })
      }

      // Type headers and services
      const typeOrder: ServiceType[] = ['frontend', 'backend', 'other']
      for (const serviceType of typeOrder) {
        const services = typeMap.get(serviceType)
        if (!services || services.length === 0) continue

        const runningCount = services.filter(s => {
          const rt = runtimeStore.getRuntime(s.id)
          return rt?.status === 'running' || rt?.status === 'starting'
        }).length

        // Type header
        rows.push({
          type: 'type-header' as any,
          serviceType,
          serviceCount: services.length,
          runningCount,
          indent: showProjectHeader ? 2 : 1,
        } as any)

        // Service rows
        for (const svc of services) {
          rows.push({
            service: svc,
            runtime: runtimeStore.getRuntime(svc.id),
            indent: showProjectHeader ? 2 : 1,
          })
        }
      }
    }
  }

  return rows
})

async function openLocalUrl(url: string): Promise<void> {
  try {
    await api.system.openExternal(url)
  } catch (err) {
    console.error('[ServiceTable] openExternal failed:', err)
  }
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    // fallback: 静默失败，用户可手动复制
  }
}

const columns = computed(() => [
  {
    title: () => h(NCheckbox, {
      checked: isAllSelected.value,
      indeterminate: isIndeterminate.value,
      onUpdateChecked: toggleSelectAll,
    }),
    key: 'selection',
    width: 48,
    render: (row: DataTableRow) => {
      if ('type' in row) return null
      const svc = (row as TableRow).service
      return h(NCheckbox, {
        checked: isSelected(svc.id),
        onUpdateChecked: (checked: boolean) => toggleSelection(svc.id, checked),
      })
    },
  },
  {
    title: '服务名',
    key: 'name',
    width: 200,
    render: (row: DataTableRow) => {
      if ('type' in row && row.type === 'workspace-header') {
        return h('div', { class: 'workspace-group-header' }, [
          h('span', { class: 'workspace-group-name' }, row.workspace.name),
          h('span', { class: 'workspace-group-count' },
            `${row.runningCount}/${row.serviceCount} 运行中`
          ),
        ])
      }
      if ('type' in row && row.type === 'project-header') {
        return h('div', { class: 'project-group-header' }, [
          h('span', { class: 'project-group-name' }, row.projectName),
          h('span', { class: 'project-group-count' },
            `${row.runningCount}/${row.serviceCount} 运行中`
          ),
        ])
      }
      if ('type' in row) return null
      // Service row: show type badge + name
      const svc = (row as TableRow).service
      const indent = 'indent' in row ? (row as any).indent : 0
      return h('div', {
        style: { paddingLeft: `${indent * 20}px` }
      }, [
        h('span', {
          style: {
            fontSize: '10px',
            fontWeight: '500',
            color: getServiceTypeColor(svc.type),
            backgroundColor: `${getServiceTypeColor(svc.type)}15`,
            padding: '2px 6px',
            borderRadius: '4px',
            marginRight: '8px',
          }
        }, getServiceTypeLabel(svc.type)),
        h('span', { style: { fontWeight: '500' } }, svc.name),
      ])
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 120,
    render: (row: DataTableRow) => {
      if ('type' in row) return null
      const rt = (row as TableRow).runtime
      return h(StatusBadge, {
        status: (rt?.status ?? 'stopped') as ProcessStatus,
      })
    },
  },
  {
    title: '端口',
    key: 'port',
    width: 100,
    render: (row: DataTableRow) => {
      if ('type' in row) return null
      const svc = (row as TableRow).service
      const runtime = (row as TableRow).runtime
      const conflict = runtimeStore.getPortConflict(svc.id)
      if (conflict) {
        return h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h('span', { class: 'mono port-conflict' }, [
            h(NText, { type: 'warning', depth: 1 }, { default: () => String(conflict.runtimePort) }),
            h(NText, { depth: 3, style: { marginLeft: '4px', fontSize: '11px' } }, { default: () => '⚠' }),
          ]),
          default: () => conflict.message,
        })
      }
      // configured 优先，runtime 兜底
      const port = runtimeStore.getEffectivePort(svc.id, svc.port)
      if (!port) return h('span', { style: { color: 'var(--text-4)' } }, '—')
      // runtime 检测到但无 configured → 标记为运行时发现
      const isRuntime = !svc.port
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => h('span', { class: 'mono' }, String(port)),
        default: () => isRuntime ? '运行时检测到的端口' : `配置端口 ${port}`,
      })
    },
  },
  {
    title: 'Local',
    key: 'local',
    width: 80,
    render: (row: DataTableRow) => {
      if ('type' in row) return null
      const svc = (row as TableRow).service
      const url = runtimeStore.getEffectiveUrl(svc.id, svc.port)
      if (!url) return h('span', { style: { color: 'var(--text-4)' } }, '—')

      return h(NButton, {
        quaternary: true,
        size: 'small',
        type: 'info',
        onClick: () => openLocalUrl(url),
      }, {
        icon: () => h(NIcon, null, { default: () => h(LinkOutline) }),
        default: () => 'Local',
      })
    },
  },
  {
    title: '命令',
    key: 'command',
    width: 180,
    render: (row: DataTableRow) => {
      if ('type' in row) return null
      const svc = (row as TableRow).service
      const cmd = `${svc.command} ${(svc.args ?? []).join(' ')}`
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => h('span', {
          class: 'mono',
          style: { fontSize: '12px', color: 'var(--text-3)', cursor: 'default' }
        }, cmd.length > 24 ? cmd.slice(0, 24) + '...' : cmd),
        default: () => cmd,
      })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row: DataTableRow) => {
      if ('type' in row) return null
      const svc = (row as TableRow).service
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
])
</script>

<template>
  <div class="service-table-container">
    <NDataTable
    :columns="columns"
    :data="tableData"
    :bordered="false"
    :single-line="false"
    :row-class-name="getRowClassName"
    size="small"
  />

  <!-- Batch Delete Confirmation Modal -->
  <NModal
    v-model:show="showBatchDeleteModal"
    preset="dialog"
    type="error"
    title="批量删除确认"
    :action-style="{ gap: '12px' }"
  >
    <template #icon>
      <NIcon size="48" color="var(--n-error-color)"><TrashBinOutline /></NIcon>
    </template>
    <div>
      <p style="margin-bottom: 12px;">
        确定要删除选中的 <strong>{{ selectedServiceIds.size }}</strong> 个服务吗？
      </p>
      <p style="color: var(--n-warning-color); font-size: 13px;">
        此操作将：
      </p>
      <ul style="color: var(--n-text-color-3); font-size: 13px; margin: 8px 0; padding-left: 20px;">
        <li>停止运行中的进程</li>
        <li>删除服务配置</li>
        <li>清除相关日志</li>
      </ul>
      <p style="color: var(--n-text-color-3); font-size: 13px;">
        此操作不可恢复。
      </p>
    </div>
    <template #action>
      <NButton @click="showBatchDeleteModal = false" :disabled="batchDeleting">
        取消
      </NButton>
      <NButton type="error" :loading="batchDeleting" @click="performBatchDelete">
        确认删除
      </NButton>
    </template>
  </NModal>
  </div>
</template>

<script lang="ts">
function getRowClassName(row: DataTableRow): string {
  if ('type' in row) {
    if (row.type === 'workspace-header') return 'workspace-header-row'
    if (row.type === 'project-header') return 'project-header-row'
    if (row.type === 'type-header') return 'type-header-row'
  }
  return ''
}
</script>

<style scoped>
.service-table-container {
  position: relative;
}

/* Batch Action Bar */
.batch-action-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background-color: var(--bg-surface-2);
  border-radius: 6px;
  margin-bottom: 8px;
}

/* Workspace header */
.workspace-header-row {
  background-color: var(--bg-surface-1);
}

.workspace-group-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 0;
}

.workspace-group-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-1);
}

.workspace-group-count {
  font-size: 11px;
  color: var(--text-3);
  background-color: var(--bg-surface-2);
  padding: 2px var(--sp-2);
  border-radius: var(--r-full);
}

/* Project header */
.project-header-row {
  background-color: transparent;
}

.project-group-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 4px 16px;
  border-left: 2px solid var(--accent);
  margin-left: 8px;
}

.project-group-name {
  font-weight: 500;
  font-size: 12px;
  color: var(--accent);
}

.project-group-count {
  font-size: 10px;
  color: var(--text-4);
}

/* Service row indent */
.service-row {
  display: flex;
  align-items: center;
}

.mono {
  font-family: var(--font-mono);
  font-variant-ligatures: contextual;
}

.port-conflict {
  color: var(--c-warning);
}

/* Indent service rows under type headers */
.type-header-row + tr td:first-child {
  padding-left: calc(var(--sp-8) + 4px);
}
</style>

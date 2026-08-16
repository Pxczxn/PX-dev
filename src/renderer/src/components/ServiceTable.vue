<script setup lang="ts">
// PX Dev — ServiceTable Component
// Shared service list table with start/stop/restart/forceKill actions
// Phase 7 新增：按角色分组 + Section Header + 折叠功能 + framework badge

import { computed, h, ref } from 'vue'
import {
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
import { 
  PlayOutline, 
  StopOutline, 
  RefreshOutline, 
  TrashOutline, 
  CreateOutline, 
  LinkOutline, 
  TrashBinOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  CheckmarkCircleOutline,
} from '@vicons/ionicons5'
import StatusBadge from './StatusBadge.vue'
import { useService } from '@renderer/composables/useService'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { api } from '@renderer/api'
import type { Service, ProcessStatus, ProcessRuntime, Workspace, ServiceRole } from '@shared/types'
import { formatIpcError } from '@renderer/api/errors'
import { logger } from '@renderer/utils/logger'

// ============ Group Mode ============
export type GroupMode = 'flat' | 'role-only' | 'workspace-role'

const props = withDefaults(defineProps<{
  services: Service[]
  workspaces?: Workspace[]
  groupMode?: GroupMode
}>(), {
  groupMode: 'flat',
})

const emit = defineEmits<{
  edit: [service: Service]
  delete: [service: Service]
  'batch-delete': [serviceIds: string[]]
}>()

// ============ Table Row Types ============
interface TableRow {
  type: 'service'
  service: Service
  runtime?: ProcessRuntime
}

interface RoleSectionRow {
  type: 'role-section'
  role: ServiceRole
  serviceCount: number
  runningCount: number
  collapsed: boolean
  workspaceId?: string
}

interface WorkspaceSectionRow {
  type: 'workspace-section'
  workspace: Workspace
  totalServiceCount: number
  totalRunningCount: number
}

type DataTableRow = TableRow | RoleSectionRow | WorkspaceSectionRow

// ============ Helper Functions ============

/** Get service role from Service */
function getServiceRole(service: Service): ServiceRole {
  if ('role' in service && service.role) {
    return service.role
  }
  if (service.type === 'frontend') {
    return 'frontend'
  }
  return 'backend'
}

/** Get role display label */
function getRoleLabel(role: ServiceRole): string {
  return ''
}

/** Get service badge label */
function getServiceBadgeLabel(service: Service): string {
  return ''
}

/** Get service badge color */
function getServiceBadgeColor(service: Service): string {
  const colors: Record<string, string> = {
    frontend: 'var(--accent)',
    node: '#52c41a',
    java: '#fa8c16',
    generic: 'var(--text-3)',
  }
  return colors[service.type] ?? 'var(--text-3)'
}

// ============ Runtime Store ============
const runtimeStore = useRuntimeStore()
const { startService, stopService, restartService, isOperating } = useService()
const message = useMessage()

// ============ Batch Selection ============
const selectedServiceIds = ref<Set<string>>(new Set())
const showBatchDeleteModal = ref(false)
const batchDeleting = ref(false)

function toggleSelection(serviceId: string, checked: boolean): void {
  if (checked) {
    selectedServiceIds.value.add(serviceId)
  } else {
    selectedServiceIds.value.delete(serviceId)
  }
}

function toggleSelectAll(checked: boolean): void {
  if (checked) {
    for (const row of tableData.value) {
      if (row.type === 'service') {
        selectedServiceIds.value.add(row.service.id)
      }
    }
  } else {
    selectedServiceIds.value.clear()
  }
}

function isSelected(serviceId: string): boolean {
  return selectedServiceIds.value.has(serviceId)
}

const isAllSelected = computed(() => {
  const serviceRows = tableData.value.filter((r) => r.type === 'service')
  if (serviceRows.length === 0) return false
  return serviceRows.every((r) => r.type === 'service' && selectedServiceIds.value.has(r.service.id))
})

const isIndeterminate = computed(() => {
  const serviceRows = tableData.value.filter((r) => r.type === 'service')
  if (serviceRows.length === 0) return false
  const selectedCount = serviceRows.filter(
    (r) => r.type === 'service' && selectedServiceIds.value.has(r.service.id)
  ).length
  return selectedCount > 0 && selectedCount < serviceRows.length
})

function openBatchDeleteModal(): void {
  if (selectedServiceIds.value.size === 0) return
  showBatchDeleteModal.value = true
}

async function batchStartServices(): Promise<void> {
  const idsToStart = Array.from(selectedServiceIds.value)
  const servicesToStart = props.services.filter((s) => idsToStart.includes(s.id))
  
  let successCount = 0
  let failCount = 0
  
  for (const svc of servicesToStart) {
    try {
      await startService(svc)
      successCount++
    } catch {
      failCount++
    }
  }
  
  if (failCount > 0) {
    message.warning(`已启动 ${successCount} 个服务，${failCount} 个失败`)
  } else {
    message.success(`已启动 ${successCount} 个服务`)
  }
}

async function batchStopServices(): Promise<void> {
  const idsToStop = Array.from(selectedServiceIds.value)
  const servicesToStop = props.services.filter((s) => idsToStop.includes(s.id))
  
  let successCount = 0
  let failCount = 0
  
  for (const svc of servicesToStop) {
    try {
      await stopService(svc)
      successCount++
    } catch {
      failCount++
    }
  }
  
  if (failCount > 0) {
    message.warning(`已停止 ${successCount} 个服务，${failCount} 个失败`)
  } else {
    message.success(`已停止 ${successCount} 个服务`)
  }
}

async function performBatchDelete(): Promise<void> {
  batchDeleting.value = true
  const idsToDelete = Array.from(selectedServiceIds.value)
  const servicesToDelete = props.services.filter((s) => idsToDelete.includes(s.id))

  try {
    for (const svc of servicesToDelete) {
      const runtime = runtimeStore.getRuntime(svc.id)
      if (runtime?.status === 'running' || runtime?.status === 'starting') {
        try {
          await api.process.stop(svc.id)
        } catch {
          await api.process.forceKill(svc.id)
        }
      }
    }

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

// ============ Collapse State ============
const collapsedKeys = ref<Set<string>>(new Set())

function toggleCollapse(key: string): void {
  if (collapsedKeys.value.has(key)) {
    collapsedKeys.value.delete(key)
  } else {
    collapsedKeys.value.add(key)
  }
  collapsedKeys.value = new Set(collapsedKeys.value)
}

function isCollapsed(key: string): boolean {
  return collapsedKeys.value.has(key)
}

// ============ Build Table Data ============
const tableData = computed((): DataTableRow[] => {
  if (props.groupMode === 'flat') {
    return props.services.map((svc) => ({
      type: 'service' as const,
      service: svc,
      runtime: runtimeStore.getRuntime(svc.id),
    }))
  }

  // Role-only mode: flat role grouping (independent of workspaces)
  if (props.groupMode === 'role-only') {
    const roleOrder: ServiceRole[] = ['frontend', 'backend']
    const rows: DataTableRow[] = []

    for (const role of roleOrder) {
      const roleServices = props.services.filter((svc) => getServiceRole(svc) === role)

      if (roleServices.length === 0) continue

      const runningCount = roleServices.filter((s) => {
        const rt = runtimeStore.getRuntime(s.id)
        return rt?.status === 'running' || rt?.status === 'starting'
      }).length

      const key = `role:${role}`
      const collapsed = isCollapsed(key)

      // Section header row
      rows.push({
        type: 'role-section',
        role,
        serviceCount: roleServices.length,
        runningCount,
        collapsed,
      })

      // Service rows (only if not collapsed)
      if (!collapsed) {
        for (const svc of roleServices) {
          rows.push({
            type: 'service',
            service: svc,
            runtime: runtimeStore.getRuntime(svc.id),
          })
        }
      }
    }

    return rows
  }

  // Workspace-role mode: workspace + role hierarchy (requires workspaces prop)
  const workspaceMap = new Map((props.workspaces ?? []).map((w) => [w.id, w]))
  const servicesByWorkspace = new Map<string, Map<ServiceRole, Service[]>>()

  for (const svc of props.services) {
    const workspace = workspaceMap.get(svc.workspaceId)
    if (!workspace) continue

    const role = getServiceRole(svc)

    if (!servicesByWorkspace.has(svc.workspaceId)) {
      servicesByWorkspace.set(svc.workspaceId, new Map())
    }
    const roleMap = servicesByWorkspace.get(svc.workspaceId)!

    if (!roleMap.has(role)) {
      roleMap.set(role, [])
    }
    roleMap.get(role)!.push(svc)
  }

  const rows: DataTableRow[] = []

  for (const [workspaceId, roleMap] of servicesByWorkspace) {
    const workspace = workspaceMap.get(workspaceId)
    if (!workspace) continue

    const roleOrder: ServiceRole[] = ['frontend', 'backend']
    let totalServiceCount = 0
    let totalRunningCount = 0
    const wsRows: DataTableRow[] = []

    for (const role of roleOrder) {
      const services = roleMap.get(role)
      if (!services || services.length === 0) continue

      const runningCount = services.filter((s) => {
        const rt = runtimeStore.getRuntime(s.id)
        return rt?.status === 'running' || rt?.status === 'starting'
      }).length

      totalServiceCount += services.length
      totalRunningCount += runningCount

      const key = `ws:${workspaceId}:${role}`
      const collapsed = isCollapsed(key)

      // Role section header row
      wsRows.push({
        type: 'role-section',
        role,
        serviceCount: services.length,
        runningCount,
        collapsed,
        workspaceId,
      })

      // Service rows (only if not collapsed)
      if (!collapsed) {
        for (const svc of services) {
          wsRows.push({
            type: 'service',
            service: svc,
            runtime: runtimeStore.getRuntime(svc.id),
          })
        }
      }
    }

    // Workspace section header row
    if (wsRows.length > 0) {
      rows.push({
        type: 'workspace-section',
        workspace,
        totalServiceCount,
        totalRunningCount,
      })
      // Add all workspace + role rows
      rows.push(...wsRows)
    }
  }

  return rows
})

// ============ Local URL ============
async function openLocalUrl(url: string): Promise<void> {
  try {
    await api.system.openExternal(url)
  } catch (err) {
    logger.error('ServiceTable', 'Failed to open external URL', err)
  }
}

// ============ Collapse Key Helper ============
function getRoleSectionKey(row: RoleSectionRow): string {
  if (row.workspaceId) {
    return `ws:${row.workspaceId}:${row.role}`
  }
  return `role:${row.role}`
}

// ============ Columns ============
const columns = computed(() => {
  const cols = []

  if (props.groupMode !== 'flat') {
    cols.push({
      title: () => h(NCheckbox, {
        checked: isAllSelected.value,
        indeterminate: isIndeterminate.value,
        onUpdateChecked: toggleSelectAll,
      }),
      key: 'selection',
      width: 48,
      render: (row: DataTableRow) => {
        if (row.type !== 'service') return null
        const svc = row.service
        return h(NCheckbox, {
          checked: isSelected(svc.id),
          onUpdateChecked: (checked: boolean) => toggleSelection(svc.id, checked),
        })
      },
    })
  }

  cols.push({
    title: '服务名',
    key: 'name',
    width: 220,
    render: (row: DataTableRow) => {
      if (row.type === 'workspace-section') {
        return h('div', { class: 'workspace-section-header' }, [
          h('span', { class: 'workspace-section-name' }, row.workspace.name),
          h('span', { class: 'workspace-section-count' },
            `${row.totalRunningCount}/${row.totalServiceCount} 运行中`
          ),
        ])
      }

      if (row.type === 'role-section') {
        const key = getRoleSectionKey(row)
        const collapsed = isCollapsed(key)
        return h('div', {
          class: 'role-section-header',
          onClick: () => toggleCollapse(key)
        }, [
          h(NIcon, { size: 16, class: 'collapse-icon' }, {
            default: () => collapsed ? h(ChevronForwardOutline) : h(ChevronDownOutline)
          }),
          h('span', { class: 'role-section-name' }, getRoleLabel(row.role)),
        ])
      }

      if (row.type !== 'service') return null
      const svc = row.service
      return h('div', { class: 'service-name-cell' }, [
        (() => {
          const label = getServiceBadgeLabel(svc)
          if (!label) return null
          return h('span', {
            class: 'service-badge',
            style: {
              backgroundColor: `${getServiceBadgeColor(svc)}15`,
              color: getServiceBadgeColor(svc),
            }
          }, label)
        })(),
        h('span', { class: 'service-name' }, svc.name),
      ])
    },
  })

  cols.push({
    title: '状态',
    key: 'status',
    width: 100,
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const rt = row.runtime
      return h(StatusBadge, {
        status: (rt?.status ?? 'stopped') as ProcessStatus,
      })
    },
  })

  cols.push({
    title: '端口',
    key: 'port',
    width: 90,
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
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
      const port = runtimeStore.getEffectivePort(svc.id, svc.port)
      if (!port) return h('span', { style: { color: 'var(--text-4)' } }, '—')
      const isRuntime = !svc.port
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => h('span', { class: 'mono' }, String(port)),
        default: () => isRuntime ? '运行时检测到的端口' : `配置端口 ${port}`,
      })
    },
  })

  cols.push({
    title: 'Local',
    key: 'local',
    width: 80,
    minWidth: 100,
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
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
  })

  cols.push({
    title: '命令',
    key: 'command',
    width: 180,
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const cmd = `${svc.command} ${(svc.args ?? []).join(' ')}`
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => h('span', {
          class: 'mono command-text',
        }, cmd.length > 24 ? cmd.slice(0, 24) + '...' : cmd),
        default: () => cmd,
      })
    },
  })

  cols.push({
    title: '操作',
    key: 'actions',
    width: 180,
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const rt = row.runtime
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
  })

  return cols
})

// ============ Row Class ============
function getRowClassName(row: DataTableRow): string {
  if (row.type === 'workspace-section') return 'workspace-section-row'
  if (row.type === 'role-section') return 'role-section-row'
  return ''
}

// ============ Expose ============
defineExpose({
  selectedCount: computed(() => selectedServiceIds.value.size),
  clearSelection: () => selectedServiceIds.value.clear(),
  openBatchDeleteModal: () => {
    if (selectedServiceIds.value.size > 0) {
      showBatchDeleteModal.value = true
    }
  },
})
</script>

<template>
  <div class="service-table-container">
    <!-- Batch Selection Toolbar -->
    <Transition name="batch-toolbar-fade">
      <div v-if="selectedServiceIds.size > 0" class="batch-selection-toolbar">
        <div class="batch-info">
          <NIcon :component="CheckmarkCircleOutline" :size="20" color="var(--accent)" />
          <span class="batch-count">已选择 <strong>{{ selectedServiceIds.size }}</strong> 个服务</span>
        </div>
        <div class="batch-actions">
          <NButton size="small" @click="selectedServiceIds.clear()">
            取消选择
          </NButton>
          <NButton size="small" type="primary" @click="batchStartServices">
            <template #icon><PlayOutline /></template>
            批量启动
          </NButton>
          <NButton size="small" @click="batchStopServices">
            <template #icon><StopOutline /></template>
            批量停止
          </NButton>
          <NButton size="small" type="error" @click="openBatchDeleteModal">
            <template #icon><TrashBinOutline /></template>
            批量删除
          </NButton>
        </div>
      </div>
    </Transition>

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

<style scoped>
.service-table-container {
  position: relative;
}

/* Batch Selection Toolbar */
.batch-selection-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  margin-bottom: var(--sp-3);
  backdrop-filter: blur(8px);
}

.batch-info {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.batch-count {
  font-size: 14px;
  color: var(--text-1);
}

.batch-count strong {
  color: var(--accent);
  font-weight: 600;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* Batch toolbar animation */
.batch-toolbar-fade-enter-active,
.batch-toolbar-fade-leave-active {
  transition: all var(--dur-2) var(--ease-out);
}

.batch-toolbar-fade-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.batch-toolbar-fade-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

/* Workspace section */
.workspace-section-row {
  background-color: var(--bg-surface-1);
}

.workspace-section-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 8px 0;
}

.workspace-section-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-1);
}

.workspace-section-count {
  font-size: 12px;
  color: var(--text-3);
  background-color: var(--bg-surface-2);
  padding: 2px var(--sp-2);
  border-radius: var(--r-full);
}

/* Role section header */
.role-section-row {
  background-color: var(--bg-surface-2);
}

.role-section-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 10px 16px;
  cursor: pointer;
  user-select: none;
  height: 40px;
  box-sizing: border-box;
}

.role-section-header:hover {
  background-color: var(--bg-surface-3);
}

.collapse-icon {
  color: var(--text-3);
}

.role-section-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--text-1);
}

.role-section-count {
  font-size: 12px;
  color: var(--text-3);
  margin-left: auto;
}

/* Service name cell */
.service-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.service-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.service-name {
  font-weight: 500;
  color: var(--text-1);
}

/* Mono text */
.mono {
  font-family: var(--font-mono);
  font-variant-ligatures: contextual;
}

.command-text {
  font-size: 12px;
  color: var(--text-3);
}

.port-conflict {
  color: var(--c-warning);
}
</style>

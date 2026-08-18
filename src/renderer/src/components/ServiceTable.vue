<script setup lang="ts">
// PX Dev — ServiceTable 组件
// 统一的服务列表表格，支持按角色/工作区分组、批量操作、折叠、搜索过滤

// ============ 依赖引入 ============
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
  NInput,
  useMessage,
} from 'naive-ui'
import {
  PlayOutline,     // 启动
  StopOutline,     // 停止
  RefreshOutline,  // 重启
  TrashOutline,    // 删除
  CreateOutline,   // 编辑
  LinkOutline,     // 浏览器打开
  TrashBinOutline, // 批量删除
  ChevronDownOutline,       // 展开分组
  ChevronForwardOutline,     // 折叠分组
  CheckmarkCircleOutline,   // 选中指示
  DocumentTextOutline,      // 查看日志
  SearchOutline,   // 搜索
  CloseOutline,    // 清除搜索
} from '@vicons/ionicons5'
import { useRouter } from 'vue-router'
import StatusBadge from './StatusBadge.vue'
import { useService } from '@renderer/composables/useService'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { useLogStore } from '@renderer/stores/logStore'
import { api } from '@renderer/api'
import type { Service, ProcessStatus, ProcessRuntime, Workspace, ServiceRole } from '@shared/types'
import { formatIpcError } from '@renderer/api/errors'
import { logger } from '@renderer/utils/logger'

// ============ 组件 Props & Emits ============
// groupMode: 表格分组模式
//   - flat:         平铺，无分组
//   - role-only:    按前端/后端角色分组
//   - workspace-role: 先按工作区分组，再按角色分子组
export type GroupMode = 'flat' | 'role-only' | 'workspace-role'

const props = withDefaults(defineProps<{
  services: Service[]       // 要展示的服务列表
  workspaces?: Workspace[]  // 工作区列表（workspace-role 模式需要）
  groupMode?: GroupMode     // 分组方式，默认 flat
}>(), {
  groupMode: 'flat',
})

const emit = defineEmits<{
  edit: [service: Service]           // 编辑某个服务
  delete: [service: Service]        // 删除某个服务
  'batch-delete': [serviceIds: string[]]  // 批量删除后通知父组件
}>()

// ============ 表格行类型定义 ============
// 表格中每个行的类型，section 行用于展示分组标题
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
  workspaceId?: string  // workspace-role 模式下需要
}

interface WorkspaceSectionRow {
  type: 'workspace-section'
  workspace: Workspace
  totalServiceCount: number
  totalRunningCount: number
}

type DataTableRow = TableRow | RoleSectionRow | WorkspaceSectionRow

// ============ 辅助函数 ============
// 根据服务判断角色（优先用 role 字段，兜底用 type）
function getServiceRole(service: Service): ServiceRole {
  if ('role' in service && service.role) {
    return service.role
  }
  if (service.type === 'frontend') {
    return 'frontend'
  }
  return 'backend'
}

// 角色中文标签
function getRoleLabel(role: ServiceRole): string {
  return role === 'frontend' ? '前端服务' : '后端服务'
}

// ============ Store & 全局状态 ============
const runtimeStore = useRuntimeStore()
const router = useRouter()
const logStore = useLogStore()
const { startService, stopService, restartService, isOperating } = useService()
const message = useMessage()

// ============ 搜索 & 过滤 ============
// 搜索关键词
const searchText = ref('')

// 端口冲突终止按钮的 loading 状态（每个服务一个）
const portKillLoading = ref<Map<string, boolean>>(new Map())

/** 查询并终止占用某个端口的进程 */
async function killPortProcess(serviceId: string, port: number): Promise<void> {
  portKillLoading.value.set(serviceId, true)
  portKillLoading.value = new Map(portKillLoading.value)
  try {
    const owner = await api.port.owner(port)
    if (owner) {
      const { api: apiModule } = await import('@renderer/api')
      const { success } = await apiModule.port.kill(owner.pid)
      if (success) {
        message.success(`已终止 PID ${owner.pid} (${owner.name})`)
      } else {
        message.error('终止进程失败')
      }
    }
  } catch (err) {
    logger.error('ServiceTable', 'Failed to kill port process', err)
    message.error('终止进程失败')
  } finally {
    portKillLoading.value.set(serviceId, false)
    portKillLoading.value = new Map(portKillLoading.value)
  }
}

/** 根据关键词过滤服务（匹配名称、命令、类型） */
const filteredServices = computed(() => {
  if (!searchText.value.trim()) return props.services
  const query = searchText.value.toLowerCase().trim()
  return props.services.filter((svc) => {
    const nameMatch = svc.name.toLowerCase().includes(query)
    const cmdMatch = `${svc.command} ${(svc.args ?? []).join(' ')}`.toLowerCase().includes(query)
    const typeMatch = svc.type.toLowerCase().includes(query)
    return nameMatch || cmdMatch || typeMatch
  })
})

/** 过滤后，同步清掉已选但被过滤掉的项 */
function syncSelectionOnFilter(): void {
  const currentIds = new Set(filteredServices.value.map((s) => s.id))
  const toRemove: string[] = []
  selectedServiceIds.value.forEach((id) => {
    if (!currentIds.has(id)) {
      toRemove.push(id)
    }
  })
  toRemove.forEach((id) => selectedServiceIds.value.delete(id))
}

/** 清除搜索 */
function clearSearch(): void {
  searchText.value = ''
}

// ============ 批量选择 ============
// 选中的服务 ID 集合
const selectedServiceIds = ref<Set<string>>(new Set())
const showBatchDeleteModal = ref(false)   // 批量删除确认弹窗
const batchDeleting = ref(false)          // 批量删除进行中

// 批量操作进度
interface BatchProgress {
  total: number
  current: number
  label: string
}
const batchProgress = ref<BatchProgress | null>(null)

function updateProgress(current: number, total: number, label: string): void {
  batchProgress.value = { current, total, label }
}

function clearProgress(): void {
  batchProgress.value = null
}

// 切换单行选中状态
function toggleSelection(serviceId: string, checked: boolean): void {
  if (checked) {
    selectedServiceIds.value.add(serviceId)
  } else {
    selectedServiceIds.value.delete(serviceId)
  }
}

// 切换全选
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

// 是否全部选中
const isAllSelected = computed(() => {
  const serviceRows = tableData.value.filter((r) => r.type === 'service')
  if (serviceRows.length === 0) return false
  return serviceRows.every((r) => r.type === 'service' && selectedServiceIds.value.has(r.service.id))
})

// 是否部分选中（不确定状态）
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

/** 批量启动选中的服务 */
async function batchStartServices(): Promise<void> {
  const idsToStart = Array.from(selectedServiceIds.value)
  const servicesToStart = props.services.filter((s) => idsToStart.includes(s.id))

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < servicesToStart.length; i++) {
    const svc = servicesToStart[i]
    updateProgress(i + 1, servicesToStart.length, `启动 ${svc.name}...`)
    try {
      await startService(svc)
      successCount++
    } catch {
      failCount++
    }
  }
  clearProgress()

  if (failCount > 0) {
    message.warning(`已启动 ${successCount} 个服务，${failCount} 个失败`)
  } else {
    message.success(`已启动 ${successCount} 个服务`)
  }
}

/** 批量停止选中的服务 */
async function batchStopServices(): Promise<void> {
  const idsToStop = Array.from(selectedServiceIds.value)
  const servicesToStop = props.services.filter((s) => idsToStop.includes(s.id))

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < servicesToStop.length; i++) {
    const svc = servicesToStop[i]
    updateProgress(i + 1, servicesToStop.length, `停止 ${svc.name}...`)
    try {
      await stopService(svc)
      successCount++
    } catch {
      failCount++
    }
  }
  clearProgress()

  if (failCount > 0) {
    message.warning(`已停止 ${successCount} 个服务，${failCount} 个失败`)
  } else {
    message.success(`已停止 ${successCount} 个服务`)
  }
}

/** 执行批量删除（先停进程，再删配置） */
async function performBatchDelete(): Promise<void> {
  batchDeleting.value = true
  const idsToDelete = Array.from(selectedServiceIds.value)
  const servicesToDelete = props.services.filter((s) => idsToDelete.includes(s.id))

  try {
    // 第一步：停止所有运行中的进程
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

    // 第二步：删除服务配置
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

// ============ 折叠状态（localStorage 持久化） ============
const STORAGE_KEY = 'px-dev:service-table:collapsed'

// 从 localStorage 恢复折叠状态
function loadCollapsedKeys(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        collapsedKeys.value = new Set(parsed)
      }
    }
  } catch {
    // ignore
  }
}

// 保存折叠状态到 localStorage
function saveCollapsedKeys(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedKeys.value]))
  } catch {
    // ignore
  }
}

// 切换某个分组的折叠状态
function toggleCollapse(key: string): void {
  if (collapsedKeys.value.has(key)) {
    collapsedKeys.value.delete(key)
  } else {
    collapsedKeys.value.add(key)
  }
  collapsedKeys.value = new Set(collapsedKeys.value)
  saveCollapsedKeys()
}

function isCollapsed(key: string): boolean {
  return collapsedKeys.value.has(key)
}

const collapsedKeys = ref<Set<string>>(new Set())
// 初始化时加载持久化的折叠状态
loadCollapsedKeys()

// ============ 构建表格数据 ============
// 根据 groupMode 将 services 组装成行数组（含 section header）
const tableData = computed((): DataTableRow[] => {
  // flat 模式：直接返回服务行
  if (props.groupMode === 'flat') {
    return filteredServices.value.map((svc) => ({
      type: 'service' as const,
      service: svc,
      runtime: runtimeStore.getRuntime(svc.id),
    }))
  }

  // role-only 模式：先按前端/后端分组，每组一个折叠 header
  if (props.groupMode === 'role-only') {
    const roleOrder: ServiceRole[] = ['frontend', 'backend']
    const rows: DataTableRow[] = []

    for (const role of roleOrder) {
      const roleServices = filteredServices.value.filter((svc) => getServiceRole(svc) === role)

      if (roleServices.length === 0) continue

      const runningCount = roleServices.filter((s) => {
        const rt = runtimeStore.getRuntime(s.id)
        return rt?.status === 'running' || rt?.status === 'starting'
      }).length

      const key = `role:${role}`
      const collapsed = isCollapsed(key)

      // 分组标题行
      rows.push({
        type: 'role-section',
        role,
        serviceCount: roleServices.length,
        runningCount,
        collapsed,
      })

      // 非折叠时，追加服务行
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

  // workspace-role 模式：先按工作区分组，再在每个工作区下按角色分组
  const workspaceMap = new Map((props.workspaces ?? []).map((w) => [w.id, w]))
  const servicesByWorkspace = new Map<string, Map<ServiceRole, Service[]>>()

  for (const svc of filteredServices.value) {
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

      // 角色子分组标题
      wsRows.push({
        type: 'role-section',
        role,
        serviceCount: services.length,
        runningCount,
        collapsed,
        workspaceId,
      })

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

    // 工作区总标题
    if (wsRows.length > 0) {
      rows.push({
        type: 'workspace-section',
        workspace,
        totalServiceCount,
        totalRunningCount,
      })
      rows.push(...wsRows)
    }
  }

  return rows
})

// ============ 浏览器打开 URL ============
async function openLocalUrl(url: string): Promise<void> {
  try {
    await api.system.openExternal(url)
  } catch (err) {
    logger.error('ServiceTable', 'Failed to open external URL', err)
  }
}

// ============ 分组 Key 工具 ============
// 用于折叠状态的唯一 key
function getRoleSectionKey(row: RoleSectionRow): string {
  if (row.workspaceId) {
    return `ws:${row.workspaceId}:${row.role}`
  }
  return `role:${row.role}`
}

// ============ 表格列定义 ============
// 各列的宽度（px），通过调整 width/minWidth 来优化视觉比例
const columns = computed(() => {
  const cols = []

  // ------ 多选列（仅非 flat 模式显示）------
  if (props.groupMode !== 'flat') {
    cols.push({
      title: () => h(NCheckbox, {
        checked: isAllSelected.value,
        indeterminate: isIndeterminate.value,
        onUpdateChecked: toggleSelectAll,
      }),
      key: 'selection',
      width: 40,  // ← 勾选列宽度（紧凑）
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

  // ------ 服务名列 ------
  cols.push({
    title: '服务名',
    key: 'name',
    minWidth: 130,  // ← 服务名最小宽度
    resizable: true,  // 允许拖拽调整宽度
    ellipsis: { tooltip: true },  // 文字过长时显示 tooltip
    render: (row: DataTableRow) => {
      // 工作区总标题行
      if (row.type === 'workspace-section') {
        return h('div', { class: 'workspace-section-header' }, [
          h('span', { class: 'workspace-section-name' }, row.workspace.name),
          h('span', { class: 'workspace-section-count' },
            `${row.totalRunningCount}/${row.totalServiceCount} 运行中`
          ),
        ])
      }

      // 角色分组标题行（可点击折叠/展开）
      if (row.type === 'role-section') {
        const key = getRoleSectionKey(row)
        const collapsed = isCollapsed(key)
        return h('div', {
          class: 'role-section-header',
          onClick: () => toggleCollapse(key)
        }, [
          h(NIcon, { size: 14, class: 'collapse-icon' }, {
            default: () => collapsed ? h(ChevronForwardOutline) : h(ChevronDownOutline)
          }),
          h('span', { class: 'role-section-name' }, getRoleLabel(row.role)),
        ])
      }

      if (row.type !== 'service') return null
      const svc = row.service
      return h('div', { class: 'service-name-cell' }, [
        h('span', { class: 'service-name' }, svc.name),
      ])
    },
  })

  // ------ 状态列 ------
  cols.push({
    title: '状态',
    key: 'status',
    width: 105,  // ← 状态列宽度（适配 badge + 运行时长）
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const rt = row.runtime
      return h(StatusBadge, {
        status: (rt?.status ?? 'stopped') as ProcessStatus,
        serviceId: svc.id,
      })
    },
  })

  // ------ 端口列 ------
  cols.push({
    title: '端口',
    key: 'port',
    width: 75,  // ← 端口列宽度
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const conflict = runtimeStore.getPortConflict(svc.id)

      // 有端口冲突时：显示端口号 + 警告图标 + 终止按钮
      if (conflict) {
        const loading = portKillLoading.value.get(svc.id) ?? false
        return h('div', { class: 'port-conflict-cell' }, [
          h(NText, { type: 'warning', depth: 1, class: 'mono port-value' }, { default: () => String(conflict.runtimePort) }),
          h(NTooltip, { trigger: 'hover' }, {
            trigger: () => h('span', { class: 'port-warning-icon' }, '⚠'),
            default: () => conflict.message,
          }),
          h(NButton, {
            size: 'tiny',
            type: 'error',
            quaternary: true,
            loading,
            onClick: (e: Event) => {
              e.stopPropagation()
              killPortProcess(svc.id, conflict.runtimePort)
            },
          }, { default: () => '终止' }),
        ])
      }

      // 无冲突：显示端口或占位符
      const port = runtimeStore.getEffectivePort(svc.id, svc.port)
      if (!port) return h('span', { style: { color: 'var(--text-4)' } }, '—')
      const isRuntime = !svc.port
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => h('span', { class: 'mono port-value' }, String(port)),
        default: () => isRuntime ? '运行时检测到的端口' : `配置端口 ${port}`,
      })
    },
  })

  // ------ Local 列（浏览器打开）------
  cols.push({
    title: 'Local',
    key: 'local',
    width: 70,  // ← Local 列宽度
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const url = runtimeStore.getEffectiveUrl(svc.id, svc.port)
      if (!url) return h('span', { style: { color: 'var(--text-4)' } }, '—')

      return h(NButton, {
        quaternary: true,
        size: 'tiny',
        type: 'info',
        onClick: () => openLocalUrl(url),
      }, {
        icon: () => h(NIcon, null, { default: () => h(LinkOutline) }),
        default: () => 'Local',
      })
    },
  })

  // ------ 命令列 ------
  cols.push({
    title: '命令',
    key: 'command',
    minWidth: 100,  // ← 命令列最小宽度
    ellipsis: { tooltip: true },  // 过长时 hover 显示完整命令
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const cmd = `${svc.command} ${(svc.args ?? []).join(' ')}`
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => h('span', { class: 'mono command-text' }, cmd.length > 18 ? cmd.slice(0, 18) + '...' : cmd),
        default: () => cmd,
      })
    },
  })

  // ------ 操作列 ------
  cols.push({
    title: '操作',
    key: 'actions',
    width: 160,  // ← 操作列宽度（紧凑，6个按钮）
    fixed: 'right',  // 固定在右侧
    render: (row: DataTableRow) => {
      if (row.type !== 'service') return null
      const svc = row.service
      const rt = row.runtime
      const isRunning = rt?.status === 'running' || rt?.status === 'starting'
      const op = isOperating(svc.id)

      // 6 个操作按钮：启动 / 停止 / 重启 / 日志 / 编辑 / 删除
      return h('div', { class: 'actions-cell' }, [
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(NButton, {
                quaternary: true,
                circle: true,
                size: 'tiny',
                loading: op,
                disabled: isRunning,
                class: 'action-btn',
                onClick: () => startService(svc),
              }, { default: () => h(NIcon, { size: 14 }, { default: () => h(PlayOutline) }) }),
            default: () => '启动',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(NButton, {
                quaternary: true,
                circle: true,
                size: 'tiny',
                loading: op,
                disabled: !isRunning,
                class: 'action-btn',
                onClick: () => stopService(svc),
              }, { default: () => h(NIcon, { size: 14 }, { default: () => h(StopOutline) }) }),
            default: () => '停止',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(NButton, {
                quaternary: true,
                circle: true,
                size: 'tiny',
                loading: op,
                disabled: !isRunning,
                class: 'action-btn',
                onClick: () => restartService(svc),
              }, { default: () => h(NIcon, { size: 14 }, { default: () => h(RefreshOutline) }) }),
            default: () => '重启',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(NButton, {
                quaternary: true,
                circle: true,
                size: 'tiny',
                class: 'action-btn',
                onClick: () => router.push({ path: '/logs', query: { service: svc.id } }),
              }, { default: () => h(NIcon, { size: 14 }, { default: () => h(DocumentTextOutline) }) }),
            default: () => '日志',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(NButton, {
                quaternary: true,
                circle: true,
                size: 'tiny',
                class: 'action-btn',
                onClick: () => emit('edit', svc),
              }, { default: () => h(NIcon, { size: 14 }, { default: () => h(CreateOutline) }) }),
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
              h(NButton, {
                quaternary: true,
                circle: true,
                size: 'tiny',
                type: 'error',
                class: 'action-btn',
              }, { default: () => h(NIcon, { size: 14 }, { default: () => h(TrashOutline) }) }),
            default: () => `确认删除 "${svc.name}"？`,
          },
        ),
      ])
    },
  })

  return cols
})

// ============ 行样式 ============
// 为不同类型的行添加 CSS class
function getRowClassName(row: DataTableRow): string {
  if (row.type === 'workspace-section') return 'workspace-section-row'
  if (row.type === 'role-section') return 'role-section-row'
  return ''
}

// ============ 暴露给父组件的方法 ============
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
    <!-- ==================== 搜索栏 ==================== -->
    <div class="table-toolbar">
      <div class="search-wrapper">
        <NInput
          v-model:value="searchText"
          placeholder="搜索服务名称、命令或类型..."
          clearable
          size="small"
          style="width: 240px;"
          @update:value="syncSelectionOnFilter"
        >
          <template #prefix>
            <NIcon :component="SearchOutline" :size="16" />
          </template>
        </NInput>
        <!-- 搜索结果计数 -->
        <span v-if="searchText && filteredServices.length !== props.services.length" class="filter-hint">
          找到 {{ filteredServices.length }} / {{ props.services.length }} 个
        </span>
      </div>
      <!-- 清除搜索按钮 -->
      <NButton
        v-if="searchText"
        text
        size="small"
        @click="clearSearch"
        class="clear-search-btn"
      >
        <template #icon><CloseOutline /></template>
        清除
      </NButton>
    </div>

    <!-- ==================== 批量操作工具栏 ==================== -->
    <Transition name="batch-toolbar-fade">
      <div v-if="selectedServiceIds.size > 0" class="batch-selection-toolbar">
        <div class="batch-info">
          <NIcon :component="CheckmarkCircleOutline" :size="18" color="var(--accent)" />
          <span class="batch-count">已选择 <strong>{{ selectedServiceIds.size }}</strong> 个服务</span>
        </div>
        <!-- 批量操作进度指示器 -->
        <div v-if="batchProgress" class="batch-progress">
          <span class="progress-label">{{ batchProgress.label }}</span>
          <span class="progress-count">{{ batchProgress.current }}/{{ batchProgress.total }}</span>
        </div>
        <div class="batch-actions">
          <NButton size="small" @click="selectedServiceIds.clear()">
            取消选择
          </NButton>
          <NButton size="small" type="primary" @click="batchStartServices" :disabled="!!batchProgress">
            <template #icon><PlayOutline /></template>
            批量启动
          </NButton>
          <NButton size="small" @click="batchStopServices" :disabled="!!batchProgress">
            <template #icon><StopOutline /></template>
            批量停止
          </NButton>
          <NButton size="small" type="error" @click="openBatchDeleteModal" :disabled="!!batchProgress">
            <template #icon><TrashBinOutline /></template>
            批量删除
          </NButton>
        </div>
      </div>
    </Transition>

    <!-- ==================== 数据表格 ==================== -->
    <div class="table-wrapper">
      <NDataTable
        :columns="columns"
        :data="tableData"
        :bordered="false"
        :single-line="false"
        :row-class-name="getRowClassName"
        size="small"
        :scroll-x="640"
      />
    </div>

    <!-- ==================== 批量删除确认弹窗 ==================== -->
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
/* ==================== 容器 ==================== */
.service-table-container {
  position: relative;
}

/* ==================== 表格包装器 ==================== */
.table-wrapper {
  border-radius: var(--r-md);
  overflow: hidden;
}

/* ==================== 搜索栏 ==================== */
.table-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
  flex-wrap: wrap;
}

.search-wrapper {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 1;
}

.filter-hint {
  font-size: 12px;
  color: var(--text-4);
  white-space: nowrap;
}

.clear-search-btn {
  color: var(--text-3);
  flex-shrink: 0;
}

.clear-search-btn:hover {
  color: var(--accent);
}

/* ==================== 批量操作工具栏 ==================== */
.batch-selection-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  margin-bottom: var(--sp-3);
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.batch-info {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.batch-count {
  font-size: 13px;
  color: var(--text-1);
}

.batch-count strong {
  color: var(--accent);
  font-weight: 600;
}

/* 进度指示器 */
.batch-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  padding: 3px 8px;
  border-radius: var(--r-full);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
}

.progress-label {
  font-weight: 500;
}

.progress-count {
  font-family: var(--font-mono);
  font-size: 11px;
  opacity: 0.8;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

/* 工具栏淡入淡出动画 */
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

/* ==================== 分组标题行 ==================== */
/* 工作区标题行背景 */
.workspace-section-row {
  background-color: var(--bg-surface-1);
}

.workspace-section-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 0;
}

.workspace-section-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-1);
}

.workspace-section-count {
  font-size: 11px;
  color: var(--text-3);
  background-color: var(--bg-surface-2);
  padding: 2px 8px;
  border-radius: var(--r-full);
}

/* 角色分组标题行背景 */
.role-section-row {
  background-color: var(--bg-surface-2);
}

.role-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
}

.role-section-header:hover {
  background-color: var(--bg-hover);
}

.collapse-icon {
  color: var(--text-3);
}

.role-section-name {
  font-weight: 500;
  font-size: 12px;
  color: var(--text-1);
  letter-spacing: 0.02em;
}

/* ==================== 服务单元格 ==================== */
.service-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.service-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--text-1);
}

/* ==================== 通用样式 ==================== */
/* 端口值 */
.port-value {
  font-size: 12px;
}

/* 等宽字体（用于端口、命令列） */
.mono {
  font-family: var(--font-mono);
  font-variant-ligatures: contextual;
  font-size: 12px;
}

.command-text {
  color: var(--text-3);
}

/* 端口冲突样式 */
.port-conflict-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.port-warning-icon {
  color: var(--c-warning);
  font-size: 12px;
  cursor: help;
}

/* ==================== 操作按钮单元格 ==================== */
.actions-cell {
  display: flex;
  align-items: center;
  gap: 2px;
}

.action-btn {
  opacity: 0.7;
  transition: opacity var(--dur-1) var(--ease-out);
}

.action-btn:hover {
  opacity: 1;
}
</style>

<script setup lang="ts">
// PX Dev — WorkspaceDetailView
// Workspace detail page with role-based service grouping

import { onMounted, ref, computed, h, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton,
  NSpin,
  NCard,
  NDropdown,
  NPopconfirm,
  useMessage,
  NIcon,
} from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import {
  PlayOutline,
  StopOutline,
  AddOutline,
  SearchOutline,
  TrashBinOutline,
  EllipsisVerticalOutline,
  FolderOpenOutline,
  CreateOutline,
  TrashOutline,
  ArrowBackOutline,
  ChevronForwardOutline,
} from '@vicons/ionicons5'
import ServiceTable from '@renderer/components/ServiceTable.vue'
const ServiceEditDrawer = defineAsyncComponent(() => import('@renderer/components/ServiceEditDrawer.vue'))
const WorkspaceDiscoveryModal = defineAsyncComponent(() => import('@renderer/components/WorkspaceDiscoveryModal.vue'))
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { api } from '@renderer/api'
import type { Service } from '@shared/types'
import { logger } from '@renderer/utils/logger'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const workspaceStore = useWorkspaceStore()
const runtimeStore = useRuntimeStore()

const workspaceId = computed(() => route.params.id as string)
const workspace = computed(() => workspaceStore.getWorkspace(workspaceId.value))
const services = computed(() => workspaceStore.getServicesByWorkspace(workspaceId.value))

// Stats
const serviceCount = computed(() => services.value.length)
const runningCount = computed(() => {
  let count = 0
  for (const svc of services.value) {
    const rt = runtimeStore.getRuntime(svc.id)
    if (rt?.status === 'running' || rt?.status === 'starting') {
      count++
    }
  }
  return count
})

// Frontend/Backend counts
const frontendCount = computed(() => services.value.filter((s) => s.role === 'frontend').length)
const frontendRunningCount = computed(() => {
  let count = 0
  for (const svc of services.value) {
    if (svc.role !== 'frontend') continue
    const rt = runtimeStore.getRuntime(svc.id)
    if (rt?.status === 'running' || rt?.status === 'starting') count++
  }
  return count
})

const backendCount = computed(() => services.value.filter((s) => s.role === 'backend').length)
const backendRunningCount = computed(() => {
  let count = 0
  for (const svc of services.value) {
    if (svc.role !== 'backend') continue
    const rt = runtimeStore.getRuntime(svc.id)
    if (rt?.status === 'running' || rt?.status === 'starting') count++
  }
  return count
})

const showEditDrawer = ref(false)
const showDiscoveryModal = ref(false)
const editingService = ref<Service | null>(null)
const loading = ref(false)
const serviceTableRef = ref<InstanceType<typeof ServiceTable> | null>(null)

onMounted(async () => {
  loading.value = true
  await Promise.all([
    workspaceStore.fetchWorkspaces(),
    workspaceStore.fetchServices(),
  ])
  runtimeStore.startListening()
  await runtimeStore.syncEndpoints()
  loading.value = false
})

async function startAll(): Promise<void> {
  try {
    const results = await api.process.startWorkspace(workspaceId.value)
    const failed = results.filter((r: unknown) => (r as { error?: string }).error)
    if (failed.length > 0) {
      message.warning(`${failed.length} 个服务启动失败`)
    } else {
      message.success('所有服务已启动')
    }
    await runtimeStore.syncAll()
  } catch (err) {
    logger.error('WorkspaceDetailView', 'Failed to start all services', err)
    message.error('批量启动失败')
  }
}

async function stopAll(): Promise<void> {
  try {
    await api.process.stopWorkspace(workspaceId.value)
    message.success('所有服务已停止')
    await runtimeStore.syncAll()
  } catch (err) {
    logger.error('WorkspaceDetailView', 'Failed to stop all services', err)
    message.error('批量停止失败')
  }
}

function openAddService(): void {
  editingService.value = null
  showEditDrawer.value = true
}

function openEditService(svc: Service): void {
  editingService.value = svc
  showEditDrawer.value = true
}

async function handleDeleteService(svc: Service): Promise<void> {
  try {
    await workspaceStore.deleteService(svc.id)
    message.success(`服务 ${svc.name} 已删除`)
  } catch (err) {
    logger.error('WorkspaceDetailView', 'Failed to delete service', err)
    message.error('删除失败')
  }
}

async function handleBatchDelete(serviceIds: string[]): Promise<void> {
  try {
    await workspaceStore.fetchServices()
    await runtimeStore.syncAll()
  } catch (err) {
    logger.error('WorkspaceDetailView', 'Failed to sync after batch delete', err)
  }
}

function openBatchDeleteModal(): void {
  serviceTableRef.value?.openBatchDeleteModal()
}

// More menu
const moreMenuOptions = computed<DropdownOption[]>(() => [
  {
    label: '打开工作区目录',
    key: 'open-root',
    icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }),
  },
  {
    label: '编辑工作区',
    key: 'edit-workspace',
    icon: () => h(NIcon, null, { default: () => h(CreateOutline) }),
  },
  {
    type: 'divider',
    key: 'd1',
  },
  {
    label: '删除工作区',
    key: 'delete-workspace',
    icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
  },
])

async function handleMoreMenuSelect(key: string): Promise<void> {
  switch (key) {
    case 'open-root': {
      if (workspace.value?.rootPath) {
        try {
          await api.system.openPath(workspace.value.rootPath)
        } catch (err) {
          logger.error('WorkspaceDetailView', 'Failed to open directory', err)
          message.error('打开目录失败')
        }
      }
      break
    }
    case 'edit-workspace': {
      message.info('编辑工作区功能开发中')
      break
    }
    case 'delete-workspace': {
      await deleteWorkspace()
      break
    }
  }
}

async function deleteWorkspace(): Promise<void> {
  if (!workspace.value) return
  try {
    await workspaceStore.deleteWorkspace(workspace.value.id)
    message.success('工作区已删除')
    router.push('/workspaces')
  } catch (err) {
    logger.error('WorkspaceDetailView', 'Failed to delete workspace', err)
    message.error('删除工作区失败')
  }
}
</script>

<template>
  <div class="page-container">
    <NSpin :show="loading">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-left">
          <!-- Breadcrumb -->
          <div class="breadcrumb">
            <NButton text @click="router.push('/workspaces')" class="breadcrumb-item">
              工作区
            </NButton>
            <NIcon :component="ChevronForwardOutline" :size="14" class="breadcrumb-separator" />
            <span class="breadcrumb-item breadcrumb-current">{{ workspace?.name ?? '详情' }}</span>
          </div>
          
          <div class="title-row">
            <NButton text circle @click="router.push('/workspaces')" class="back-button">
              <template #icon><ArrowBackOutline /></template>
            </NButton>
            <h1 class="page-title">{{ workspace?.name ?? '工作区详情' }}</h1>
          </div>
          
          <div class="page-stats">
            <div class="stats-container">
              <div class="stat-card stat-frontend">
                <span class="stat-label">前端</span>
                <span class="stat-value">{{ frontendRunningCount }}<span class="stat-sep">/</span>{{ frontendCount }}</span>
              </div>
              <div class="stat-card stat-backend">
                <span class="stat-label">后端</span>
                <span class="stat-value">{{ backendRunningCount }}<span class="stat-sep">/</span>{{ backendCount }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="action-bar">
          <NButton type="primary" @click="startAll" :disabled="serviceCount === 0">
            <template #icon><PlayOutline /></template>
            全部启动
          </NButton>
          <NButton @click="stopAll" :disabled="serviceCount === 0">
            <template #icon><StopOutline /></template>
            全部停止
          </NButton>
          <NButton @click="openAddService">
            <template #icon><AddOutline /></template>
            添加服务
          </NButton>
          <NButton @click="showDiscoveryModal = true">
            <template #icon><SearchOutline /></template>
            扫描工作区
          </NButton>
          <NButton 
            v-if="serviceTableRef?.selectedCount"
            type="error" 
            @click="openBatchDeleteModal"
          >
            <template #icon><TrashBinOutline /></template>
            删除选中
          </NButton>
          
          <!-- More Menu -->
          <NDropdown 
            :options="moreMenuOptions" 
            @select="handleMoreMenuSelect"
            trigger="click"
          >
            <NButton quaternary circle>
              <template #icon><EllipsisVerticalOutline /></template>
            </NButton>
          </NDropdown>
        </div>
      </div>

      <!-- Service Table -->
      <NCard size="small" class="table-card" :bordered="false">
        <ServiceTable
          ref="serviceTableRef"
          :services="services"
          group-mode="role-only"
          @edit="openEditService"
          @delete="handleDeleteService"
          @batch-delete="handleBatchDelete"
        />
      </NCard>
    </NSpin>

    <!-- Service Edit Drawer -->
    <ServiceEditDrawer
      v-model:show="showEditDrawer"
      :service="editingService"
      :workspace-id="workspaceId"
      @saved="workspaceStore.fetchServices()"
    />

    <!-- Workspace Discovery Modal -->
    <WorkspaceDiscoveryModal
      v-model:show="showDiscoveryModal"
      :workspace-id="workspaceId"
      :root-path="workspace?.rootPath"
      @applied="workspaceStore.fetchServices()"
    />
  </div>
</template>

<style scoped>
.page-container {
  padding: var(--sp-4);
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--sp-6);
  gap: var(--sp-4);
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.breadcrumb-item {
  color: var(--text-3);
  font-size: 13px;
  padding: 0;
  transition: color var(--dur-1) var(--ease-out);
}

.breadcrumb-item:not(.breadcrumb-current):hover {
  color: var(--accent);
}

.breadcrumb-current {
  color: var(--text-2);
  font-weight: 500;
}

.breadcrumb-separator {
  color: var(--text-4);
  flex-shrink: 0;
}

/* Title row with back button */
.title-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.back-button {
  color: var(--text-3);
  font-size: 20px;
  transition: all var(--dur-1) var(--ease-out);
}

.back-button:hover {
  color: var(--accent);
  background: var(--bg-hover);
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0;
  line-height: 1.2;
}

.page-stats {
  font-size: 13px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 4px;
}

.stats-container {
  display: flex;
  gap: var(--sp-2);
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--r-md);
  background-color: var(--bg-surface-2);
  border: 1px solid var(--bg-surface-3);
}

.stat-card .stat-label {
  color: var(--text-3);
  font-size: 13px;
}

.stat-card .stat-value {
  color: var(--text-2);
  font-weight: 600;
  font-size: 14px;
  font-family: var(--font-mono);
}

.stat-card .stat-sep {
  color: var(--text-4);
  font-weight: 400;
  margin: 0 1px;
}

.stat-total {
  color: var(--text-3);
}

.action-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.table-card {
  margin-top: 0;
}
</style>

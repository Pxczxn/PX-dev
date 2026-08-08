<script setup lang="ts">
// PX Dev — WorkspaceDetailView
// Top action bar + ServiceTable for a single workspace

import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton,
  NSpace,
  NSpin,
  NCard,
  NPopconfirm,
  useMessage,
} from 'naive-ui'
import { PlayOutline, StopOutline, AddOutline, ArrowBackOutline, TrashOutline } from '@vicons/ionicons5'
import ServiceTable from '@renderer/components/ServiceTable.vue'
import ServiceEditDrawer from '@renderer/components/ServiceEditDrawer.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { api } from '@renderer/api'
import type { Service } from '@shared/types'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const workspaceStore = useWorkspaceStore()
const runtimeStore = useRuntimeStore()

const workspaceId = computed(() => route.params.id as string)
const workspace = computed(() => workspaceStore.getWorkspace(workspaceId.value))
const services = computed(() => workspaceStore.getServicesByWorkspace(workspaceId.value))

const showEditDrawer = ref(false)
const editingService = ref<Service | null>(null)
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  await Promise.all([
    workspaceStore.fetchWorkspaces(),
    workspaceStore.fetchServices(),
  ])
  runtimeStore.startListening()
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
    message.error('批量启动失败')
    console.error(err)
  }
}

async function stopAll(): Promise<void> {
  try {
    await api.process.stopWorkspace(workspaceId.value)
    message.success('所有服务已停止')
    await runtimeStore.syncAll()
  } catch (err) {
    message.error('批量停止失败')
    console.error(err)
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
    message.error('删除失败')
    console.error(err)
  }
}

async function deleteWorkspace(): Promise<void> {
  if (!workspace.value) return
  try {
    await workspaceStore.deleteWorkspace(workspace.value.id)
    message.success('工作区已删除')
    router.push('/workspaces')
  } catch (err) {
    message.error('删除工作区失败')
    console.error(err)
  }
}
</script>

<template>
  <div class="page-container">
    <NSpin :show="loading">
      <!-- Top Action Bar -->
      <div class="action-bar">
        <div class="flex-row">
          <NButton quaternary circle @click="router.push('/workspaces')">
            <ArrowBackOutline />
          </NButton>
          <h2 class="page-title">{{ workspace?.name ?? '工作区详情' }}</h2>
        </div>
        <NSpace>
          <NButton type="primary" @click="startAll" :disabled="services.length === 0">
            <template #icon><PlayOutline /></template>
            全部启动
          </NButton>
          <NButton @click="stopAll" :disabled="services.length === 0">
            <template #icon><StopOutline /></template>
            全部停止
          </NButton>
          <NButton @click="openAddService">
            <template #icon><AddOutline /></template>
            添加服务
          </NButton>
          <NPopconfirm @positive-click="deleteWorkspace">
            <template #trigger>
              <NButton type="error" quaternary>
                <template #icon><TrashOutline /></template>
                删除工作区
              </NButton>
            </template>
            确认删除工作区 "{{ workspace?.name }}"？所有关联服务将一并删除。
          </NPopconfirm>
        </NSpace>
      </div>

      <!-- Service Table -->
      <NCard size="small" class="table-card" :bordered="false">
        <ServiceTable
          :services="services"
          @edit="openEditService"
          @delete="handleDeleteService"
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
  </div>
</template>

<style scoped>
.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-6);
}
</style>

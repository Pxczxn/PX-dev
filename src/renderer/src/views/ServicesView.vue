<script setup lang="ts">
// PX Dev — ServicesView
// Global service list across all workspaces

import { onMounted, ref, computed } from 'vue'
import { NCard, NSpin, NSelect, NSpace, NButton, useMessage } from 'naive-ui'
import { AddOutline } from '@vicons/ionicons5'
import ServiceTable from '@renderer/components/ServiceTable.vue'
import ServiceEditDrawer from '@renderer/components/ServiceEditDrawer.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import type { Service } from '@shared/types'

const message = useMessage()
const workspaceStore = useWorkspaceStore()
const runtimeStore = useRuntimeStore()

const filterWorkspaceId = ref<string | null>(null)
const showEditDrawer = ref(false)
const editingService = ref<Service | null>(null)

onMounted(async () => {
  await Promise.all([
    workspaceStore.fetchWorkspaces(),
    workspaceStore.fetchServices(),
  ])
  runtimeStore.startListening()
})

const filteredServices = computed(() => {
  if (!filterWorkspaceId.value) return workspaceStore.services
  return workspaceStore.services.filter((s) => s.workspaceId === filterWorkspaceId.value)
})

const workspaceOptions = computed(() => [
  { label: '全部工作区', value: '' },
  ...workspaceStore.workspaces.map((w) => ({
    label: w.name,
    value: w.id,
  })),
])

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
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">服务</h2>
      <NSpace>
        <NSelect
          v-model:value="filterWorkspaceId"
          :options="workspaceOptions"
          style="width: 200px"
          size="small"
          placeholder="筛选工作区"
        />
        <NButton type="primary" @click="openAddService">
          <template #icon><AddOutline /></template>
          添加服务
        </NButton>
      </NSpace>
    </div>

    <NSpin :show="workspaceStore.loading">
      <NCard size="small" :bordered="false" class="table-card">
        <ServiceTable
          :services="filteredServices"
          :workspaces="workspaceStore.workspaces"
          group-mode="workspace-role"
          @edit="openEditService"
          @delete="handleDeleteService"
        />
      </NCard>
    </NSpin>

    <ServiceEditDrawer
      v-model:show="showEditDrawer"
      :service="editingService"
      :workspace-id="filterWorkspaceId || workspaceStore.workspaces[0]?.id || ''"
      @saved="workspaceStore.fetchServices()"
    />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0;
}

.table-card {
  margin-top: 0;
}
</style>

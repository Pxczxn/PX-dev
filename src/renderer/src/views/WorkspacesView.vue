<script setup lang="ts">
// PX Dev — WorkspacesView
// Card list of workspaces + create modal trigger

import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NGrid,
  NGridItem,
  NButton,
  NTag,
  NSpin,
} from 'naive-ui'
import { AddOutline, FolderOpenOutline } from '@vicons/ionicons5'
import EmptyState from '@renderer/components/EmptyState.vue'
import WorkspaceCreateModal from '@renderer/components/WorkspaceCreateModal.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import type { Workspace } from '@shared/types'

const router = useRouter()
const workspaceStore = useWorkspaceStore()
const showCreateModal = ref(false)

onMounted(async () => {
  await workspaceStore.fetchWorkspaces()
  await workspaceStore.fetchServices()
})

const sortedWorkspaces = computed(() =>
  [...workspaceStore.workspaces].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  }),
)

function openWorkspace(ws: Workspace): void {
  router.push(`/workspaces/${ws.id}`)
}
</script>

<template>
    <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">工作区</h2>
      <NButton type="primary" @click="showCreateModal = true">
        <template #icon><AddOutline /></template>
        创建工作区
      </NButton>
    </div>

    <NSpin :show="workspaceStore.loading">
      <template v-if="sortedWorkspaces.length > 0">
        <NGrid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
          <NGridItem
            v-for="ws in sortedWorkspaces"
            :key="ws.id"
            span="3 m:2 l:1"
          >
            <NCard
              hoverable
              size="small"
              class="workspace-card"
              :bordered="false"
              @click="openWorkspace(ws)"
            >
              <div class="ws-card-header">
                <div class="ws-card-icon" :style="{ background: ws.color ?? '#2b8cff' }">
                  <FolderOpenOutline />
                </div>
                <div class="ws-card-title">
                  <span class="ws-name">{{ ws.name }}</span>
                  <NTag v-if="ws.favorite" size="tiny" type="warning" :bordered="false">收藏</NTag>
                </div>
              </div>
              <div class="ws-card-desc">
                {{ ws.description || '暂无描述' }}
              </div>
              <div class="ws-card-footer">
                <span>{{ workspaceStore.getServicesByWorkspace(ws.id).length }} 个服务</span>
                <span>{{ ws.startMode === 'parallel' ? '并行启动' : ws.startMode === 'sequential' ? '顺序启动' : '依赖启动' }}</span>
              </div>
            </NCard>
          </NGridItem>
        </NGrid>
      </template>
      <template v-else-if="!workspaceStore.loading">
        <EmptyState
          title="还没有工作区"
          description="创建你的第一个工作区来管理本地开发服务"
          action-text="创建工作区"
          @action="showCreateModal = true"
        />
      </template>
    </NSpin>

    <WorkspaceCreateModal v-model:show="showCreateModal" />
  </div>
</template>

<style scoped>
.workspace-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  cursor: pointer;
  transition:
    border-color var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}

.workspace-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-2);
}

.ws-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.ws-card-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
}

.ws-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ws-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-card-desc {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 12px;
  min-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-card-footer {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-4);
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}
</style>

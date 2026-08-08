<script setup lang="ts">
// PX Dev — DashboardView
// 4 stat cards + recent workspaces + empty state guide

import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NGrid, NGridItem, NSpace } from 'naive-ui'
import StatCard from '@renderer/components/StatCard.vue'
import EmptyState from '@renderer/components/EmptyState.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'

const router = useRouter()
const workspaceStore = useWorkspaceStore()
const runtimeStore = useRuntimeStore()

const runningCount = computed(() => runtimeStore.runningCount)
const workspaceCount = computed(() => workspaceStore.workspaces.length)
const serviceCount = computed(() => workspaceStore.services.length)
const stoppedCount = computed(() =>
  runtimeStore.allRuntimes.filter(
    (r) => r.status === 'stopped' || r.status === 'exited' || r.status === 'failed',
  ).length,
)

const recentWorkspaces = computed(() =>
  [...workspaceStore.workspaces]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5),
)

const hasData = computed(() => workspaceStore.workspaces.length > 0)

onMounted(async () => {
  await Promise.all([
    workspaceStore.fetchWorkspaces(),
    workspaceStore.fetchServices(),
    runtimeStore.syncAll(),
  ])
  runtimeStore.startListening()
})

function goToWorkspaces(): void {
  router.push('/workspaces')
}

function goToWorkspace(id: string): void {
  router.push(`/workspaces/${id}`)
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">仪表盘</h2>
        <p class="page-subtitle">本地开发环境与服务的统一概览</p>
      </div>
    </div>

    <!-- Stat Cards -->
    <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 0ms">
        <StatCard label="运行中服务" :value="runningCount" icon="▶" color="#2bc16b" />
      </NGridItem>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 70ms">
        <StatCard label="工作区数" :value="workspaceCount" icon="📁" color="#2b8cff" />
      </NGridItem>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 140ms">
        <StatCard label="服务总数" :value="serviceCount" icon="⚙" color="#f5a524" />
      </NGridItem>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 210ms">
        <StatCard label="已停止" :value="stoppedCount" icon="⏹" color="#8a90a2" />
      </NGridItem>
    </NGrid>

    <!-- Recent Workspaces -->
    <NCard title="最近工作区" size="small" class="recent-card" :bordered="false">
      <template v-if="hasData">
        <NSpace vertical :size="4">
          <div
            v-for="ws in recentWorkspaces"
            :key="ws.id"
            class="workspace-item"
            @click="goToWorkspace(ws.id)"
          >
            <div class="ws-info">
              <span class="ws-name">{{ ws.name }}</span>
              <span class="ws-desc">{{ ws.description || '无描述' }}</span>
            </div>
            <div class="ws-meta">
              <span class="ws-services">
                {{ workspaceStore.getServicesByWorkspace(ws.id).length }} 个服务
              </span>
              <span class="ws-arrow">→</span>
            </div>
          </div>
        </NSpace>
      </template>
      <template v-else>
        <EmptyState
          title="还没有工作区"
          description="创建你的第一个工作区来开始管理本地开发服务"
          action-text="创建工作区"
          @action="goToWorkspaces"
        />
      </template>
    </NCard>
  </div>
</template>

<style scoped>
.page-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

.recent-card {
  margin-top: var(--sp-6);
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

/* Staggered entrance for stat cards */
.dash-stat {
  animation: card-in 0.5s var(--ease-out) both;
}

.workspace-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--r-md);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}

.workspace-item + .workspace-item {
  margin-top: 2px;
}

.workspace-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  transform: translateX(2px);
}

.workspace-item:hover .ws-arrow {
  color: var(--accent);
  transform: translateX(2px);
}

.ws-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ws-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-1);
}

.ws-desc {
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.ws-services {
  font-size: 12px;
  color: var(--text-4);
}

.ws-arrow {
  font-size: 14px;
  color: var(--text-4);
  transition: color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
</style>

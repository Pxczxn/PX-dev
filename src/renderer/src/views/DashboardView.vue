<script setup lang="ts">
// PX Dev — DashboardView
// 仪表盘：统计卡片 + 快捷操作 + 运行/停止服务列表 + 最近工作区

import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NGrid,
  NGridItem,
  NSpace,
  NButton,
  NIcon,
} from 'naive-ui'
import {
  AddOutline,
  PlayOutline,
  StopOutline,
  RefreshOutline,
  ServerOutline,
  RocketOutline,
  FolderOpenOutline,
  LayersOutline,
  HandLeftOutline,
  ChevronForwardOutline,
} from '@vicons/ionicons5'
import StatCard from '@renderer/components/StatCard.vue'
import StatusBadge from '@renderer/components/StatusBadge.vue'
import EmptyState from '@renderer/components/EmptyState.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import { useService } from '@renderer/composables/useService'
import type { Service } from '@shared/types'

const router = useRouter()
const workspaceStore = useWorkspaceStore()
const runtimeStore = useRuntimeStore()
const { startService, stopService, restartService } = useService()

// ===== 统计数据 =====
const runningCount = computed(() => runtimeStore.runningCount)
const workspaceCount = computed(() => workspaceStore.workspaces.length)
const serviceCount = computed(() => workspaceStore.services.length)
const stoppedCount = computed(() =>
  runtimeStore.allRuntimes.filter(
    (r) => r.status === 'stopped' || r.status === 'exited' || r.status === 'failed',
  ).length,
)

// 最近工作区（最多 5 个，按更新时间倒序）
const recentWorkspaces = computed(() =>
  [...workspaceStore.workspaces]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5),
)

const hasData = computed(() => workspaceStore.workspaces.length > 0)

// 运行中的服务（最多 5 个）
const runningServices = computed(() => {
  return workspaceStore.services
    .map((svc) => ({
      svc,
      runtime: runtimeStore.getRuntime(svc.id),
    }))
    .filter(({ runtime }) => runtime?.status === 'running' || runtime?.status === 'starting')
    .slice(0, 5)
})

// 已停止的服务（最多 5 个）
const stoppedServices = computed(() => {
  return workspaceStore.services
    .map((svc) => ({
      svc,
      runtime: runtimeStore.getRuntime(svc.id),
    }))
    .filter(({ runtime }) =>
      !runtime || runtime.status === 'stopped' || runtime.status === 'exited' || runtime.status === 'failed')
    .slice(0, 5)
})

onMounted(async () => {
  await Promise.all([
    workspaceStore.fetchWorkspaces(),
    workspaceStore.fetchServices(),
    runtimeStore.syncAll(),
  ])
  runtimeStore.startListening()
})

// ===== 导航函数 =====
function goToWorkspaces(): void { router.push('/workspaces') }
function goToWorkspace(id: string): void { router.push(`/workspaces/${id}`) }
function goToServices(): void { router.push('/services') }
function goToPorts(): void { router.push('/ports') }
function goToEnv(): void { router.push('/environment') }

// ===== 快捷操作 =====
async function quickStartAll(): Promise<void> {
  for (const { svc } of stoppedServices.value) {
    const rt = runtimeStore.getRuntime(svc.id)
    if (!rt || rt.status === 'stopped' || rt.status === 'exited' || rt.status === 'failed') {
      await startService(svc).catch(() => {})
    }
  }
}

async function quickStopAll(): Promise<void> {
  for (const { svc } of runningServices.value) {
    await stopService(svc).catch(() => {})
  }
}
</script>

<template>
  <div class="page-container">
    <!-- Page 标题 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">仪表盘</h2>
        <p class="page-subtitle">本地开发环境与服务的统一概览</p>
      </div>
    </div>

    <!-- ===== 统计卡片（4 列） ===== -->
    <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 0ms">
        <StatCard
          label="运行中服务"
          :value="runningCount"
          :icon="RocketOutline"
          color="var(--c-running)"
          to="/services"
        />
      </NGridItem>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 70ms">
        <StatCard
          label="工作区数"
          :value="workspaceCount"
          :icon="FolderOpenOutline"
          color="var(--accent)"
          to="/workspaces"
        />
      </NGridItem>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 140ms">
        <StatCard
          label="服务总数"
          :value="serviceCount"
          :icon="LayersOutline"
          color="var(--c-warning)"
          to="/services"
        />
      </NGridItem>
      <NGridItem span="4 m:2 l:1" class="dash-stat" style="animation-delay: 210ms">
        <StatCard
          label="已停止"
          :value="stoppedCount"
          :icon="HandLeftOutline"
          color="var(--c-stopped)"
          to="/services"
        />
      </NGridItem>
    </NGrid>

    <!-- ===== 快捷操作卡片 ===== -->
    <NCard title="快捷操作" size="small" class="quick-actions-card" :bordered="false">
      <NSpace :size="16">
        <NButton type="primary" @click="goToWorkspaces">
          <template #icon><AddOutline /></template>
          创建工作区
        </NButton>
        <NButton @click="goToServices">
          <template #icon><ServerOutline /></template>
          添加服务
        </NButton>
        <NButton @click="goToPorts">
          <template #icon><RefreshOutline /></template>
          检测端口
        </NButton>
        <NButton @click="goToEnv">
          <template #icon><RefreshOutline /></template>
          检测环境
        </NButton>
      </NSpace>
    </NCard>

    <!-- ===== 运行中 / 已停止服务（左右分栏布局） ===== -->
    <div v-if="serviceCount > 0" class="services-split-container">
      <!-- 左侧：运行中的服务 -->
      <div class="services-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="status-dot running"></span>
            运行中
          </div>
          <span class="panel-count">{{ runningServices.length }}</span>
        </div>
        <div class="panel-body">
          <template v-if="runningServices.length > 0">
            <div
              v-for="{ svc, runtime } in runningServices"
              :key="svc.id"
              class="service-item"
              @click="router.push(`/workspaces/${svc.workspaceId}`)"
            >
              <div class="service-info">
                <StatusBadge :status="(runtime?.status ?? 'stopped')" :service-id="svc.id" />
                <span class="service-name">{{ svc.name }}</span>
              </div>
              <div class="service-actions" @click.stop>
                <NButton size="tiny" quaternary circle @click="restartService(svc)">
                  <template #icon><RefreshOutline style="font-size: 12px;" /></template>
                </NButton>
                <NButton size="tiny" quaternary circle type="error" @click="stopService(svc)">
                  <template #icon><StopOutline style="font-size: 12px;" /></template>
                </NButton>
              </div>
            </div>
          </template>
          <div v-else class="panel-empty">
            <span>暂无运行中的服务</span>
          </div>
        </div>
      </div>

      <!-- 右侧分隔线 -->
      <div class="split-divider"></div>

      <!-- 右侧：已停止的服务 -->
      <div class="services-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="status-dot stopped"></span>
            已停止
          </div>
          <span class="panel-count">{{ stoppedServices.length }}</span>
        </div>
        <div class="panel-body">
          <template v-if="stoppedServices.length > 0">
            <div
              v-for="{ svc, runtime } in stoppedServices"
              :key="svc.id"
              class="service-item"
              @click="router.push(`/workspaces/${svc.workspaceId}`)"
            >
              <div class="service-info">
                <StatusBadge :status="(runtime?.status ?? 'stopped')" />
                <span class="service-name">{{ svc.name }}</span>
              </div>
              <div class="service-actions" @click.stop>
                <NButton size="tiny" quaternary circle type="primary" @click="startService(svc)">
                  <template #icon><PlayOutline style="font-size: 12px;" /></template>
                </NButton>
              </div>
            </div>
          </template>
          <div v-else class="panel-empty">
            <span>所有服务都在运行中</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 最近工作区 ===== -->
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
              <NIcon :component="ChevronForwardOutline" :size="14" class="ws-arrow" />
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
/* ===== 副标题 ===== */
.page-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

/* ===== 快捷操作卡片 ===== */
.quick-actions-card {
  margin-top: var(--sp-4);
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  transition: border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}

.quick-actions-card:hover {
  border-color: var(--border-default);
  box-shadow: var(--glow-sm);
}

/* ===== 服务分栏容器 ===== */
.services-split-container {
  display: flex;
  gap: 0;
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  overflow: hidden;
  min-height: 200px;
  transition: border-color var(--dur-2) var(--ease-out);
}

.services-split-container:hover {
  border-color: var(--border-default);
}

.split-divider {
  width: 1px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.services-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface-2);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  flex-shrink: 0;
}

.status-dot.running {
  background: var(--c-running);
  box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.2);
  animation: status-pulse 2s ease-in-out infinite;
}

.status-dot.stopped {
  background: var(--c-stopped);
}

.panel-count {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-3);
  background: var(--bg-surface-1);
  padding: 2px 8px;
  border-radius: var(--r-full);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 140px;
  color: var(--text-4);
  font-size: 13px;
}

/* 服务列表 */
.service-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 服务行 */
.service-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}

.service-item:hover {
  background: var(--bg-hover);
}

.service-info {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  flex: 1;
}

.service-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
}

.service-item:hover .service-actions {
  opacity: 1;
}

/* ===== 最近工作区卡片 ===== */
.recent-card {
  margin-top: var(--sp-5);
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  transition: border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}

.recent-card:hover {
  border-color: var(--border-default);
}

/* 卡片入场动画 */
.dash-stat {
  animation: card-in 0.5s var(--ease-out) both;
}

/* 工作区行 */
.workspace-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--r-md);
  cursor: pointer;
  border: 1px solid transparent;
  margin: 0 -14px;
  transition:
    background var(--dur-1) var(--ease-out),
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
  max-width: 300px;
}

.ws-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ws-services {
  font-size: 12px;
  color: var(--text-4);
}

.ws-arrow {
  color: var(--text-4);
  transition:
    color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}

.workspace-item:hover .ws-arrow {
  color: var(--accent);
  transform: translateX(2px);
}

/* 脉冲动画 */
@keyframes status-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.2); }
  50% { box-shadow: 0 0 0 5px rgba(43, 193, 107, 0.1); }
}
</style>

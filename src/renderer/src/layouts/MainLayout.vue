<script setup lang="ts">
// PX Dev — Main Layout
// Layered dark sidebar with 7 nav items + main content area.
// Active item uses an accent pill + left accent bar; hover/motion via tokens.

import { computed, h, type VNodeChild, type Component, onMounted, onUnmounted, ref } from 'vue'
import { useRouter, useRoute, type RouteRecordRaw } from 'vue-router'
import { NLayout, NLayoutSider, NLayoutContent, NMenu, NScrollbar, type MenuOption } from 'naive-ui'
import {
  GridOutline,
  FolderOpenOutline,
  CubeOutline,
  ServerOutline,
  DocumentTextOutline,
  TerminalOutline,
  SettingsOutline,
} from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { onRuntimeChanged } from '@renderer/api/events'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'

const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()

// Track previous status to detect transitions
const prevStatus = ref<Map<string, string>>(new Map())
const NOTIFY_KEY = 'px-dev:notify-enabled'

/** Show native OS notification if permitted */
function showNotification(title: string, body: string): void {
  if (!Notification.permission) return
  if (localStorage.getItem(NOTIFY_KEY) === '0') return
  if (Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}

/** Check if we should notify (user was away or window not focused) */
function shouldNotify(): boolean {
  return !document.hasFocus()
}

/** Handle runtime change events for notification purposes */
function handleRuntimeChange(serviceId: string, runtime: { status: string; error?: string }): void {
  const prev = prevStatus.value.get(serviceId)
  const current = runtime.status
  prevStatus.value.set(serviceId, current)

  // Skip if we don't have previous state or nothing changed
  if (!prev || prev === current) return

  const svc = workspaceStore.getService(serviceId)
  const name = svc?.name ?? serviceId

  // Only notify for meaningful transitions
  if (current === 'failed' && shouldNotify()) {
    const errMsg = runtime.error ? `: ${runtime.error}` : ''
    showNotification(`服务启动失败`, `${name}${errMsg}`)
  } else if (current === 'stopped' && prev === 'running' && shouldNotify()) {
    showNotification(`服务已停止`, `${name} 已停止运行`)
  }
}

let unsubRuntime: (() => void) | null = null

onMounted(async () => {
  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission()
  }

  // Listen to runtime changes
  unsubRuntime = onRuntimeChanged(handleRuntimeChange)

  // Restore prevStatus from current runtimes
  for (const rt of workspaceStore.services) {
    // We'll get real status from the runtime store on first load
  }
})

onUnmounted(() => {
  if (unsubRuntime) {
    unsubRuntime()
    unsubRuntime = null
  }
})

// Icon mapping
const iconMap: Record<string, Component> = {
  GridOutline,
  FolderOpenOutline,
  CubeOutline,
  ServerOutline,
  DocumentTextOutline,
  TerminalOutline,
  SettingsOutline,
}

function renderIcon(iconName: string): (() => VNodeChild) | undefined {
  const icon = iconMap[iconName]
  if (!icon) return undefined
  return () => h(NIcon, null, { default: () => h(icon) })
}

// Build menu options from router config (visible items only)
const menuOptions = computed<MenuOption[]>(() => {
  const routes = router.options.routes as RouteRecordRaw[]
  return routes
    .filter((r) => !r.meta?.hidden && r.name)
    .map((r) => ({
      label: (r.meta?.title as string) || (r.name as string),
      key: r.path,
      icon: r.meta?.icon ? renderIcon(r.meta.icon as string) : undefined,
    }))
})

// Active route key
const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/workspaces/') && path !== '/workspaces') {
    return '/workspaces'
  }
  return path
})

function handleMenuSelect(key: string): void {
  router.push(key)
}
</script>

<template>
  <NLayout has-sider class="main-layout">
    <NLayoutSider
      bordered
      :width="232"
      :collapsed-width="68"
      collapse-mode="width"
      class="app-sidebar"
    >
      <!-- Brand -->
      <div class="sidebar-brand">
        <div class="brand-mark">PX</div>
        <div class="brand-text">
          <span class="brand-name">PX Dev</span>
          <span class="brand-sub">本地开发环境</span>
        </div>
      </div>

      <NScrollbar class="sidebar-scroll">
        <NMenu
          :options="menuOptions"
          :value="activeKey"
          @update:value="handleMenuSelect"
          :indent="14"
          :collapsed-width="68"
          :collapsed-icon-size="20"
        />
      </NScrollbar>

      <!-- Footer -->
      <div class="sidebar-footer">
        <span class="status-dot" />
        <span class="footer-text">系统已就绪</span>
        <span class="footer-version">v0.1</span>
      </div>
    </NLayoutSider>

    <NLayout>
      <NLayoutContent class="app-content">
        <NScrollbar>
          <RouterView v-slot="{ Component }">
            <Transition name="route-fade" mode="out-in">
              <component :is="Component" />
            </Transition>
          </RouterView>
        </NScrollbar>
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>

<style scoped>
.main-layout {
  height: 100vh;
  overflow: hidden;
}

.app-sidebar {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

/* ---- Brand ---- */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.brand-mark {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: var(--accent-contrast);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-accent);
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.brand-sub {
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
}

/* ---- Nav scroll area ---- */
.sidebar-scroll {
  flex: 1;
  min-height: 0;
  padding: 8px 8px;
  overflow-y: auto;
}

/* ---- Footer ---- */
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--c-running);
  box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.18);
  flex-shrink: 0;
}

.footer-text {
  font-size: 11px;
  color: var(--text-3);
}

.footer-version {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-4);
  font-family: var(--font-mono);
}

.app-content {
  height: 100vh;
  background: var(--bg-content);
  overflow: hidden;
}

/* ---- Menu overrides ---- */
.app-sidebar :deep(.n-menu) {
  padding: 0 4px;
  background: transparent;
}

.app-sidebar :deep(.n-menu-item) {
  margin: 1px 0;
  border-radius: var(--r-sm);
}

.app-sidebar :deep(.n-menu-item-content) {
  border-radius: var(--r-sm);
  position: relative;
  transition: background var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
  padding: 0 12px !important;
}

/* left accent bar */
.app-sidebar :deep(.n-menu-item-content)::before {
  content: "";
  position: absolute;
  left: -2px;
  top: 50%;
  width: 3px;
  height: 18px;
  border-radius: var(--r-full);
  background: var(--accent);
  transform: translateY(-50%) scaleY(0);
  transition: transform var(--dur-2) var(--ease-out);
}

.app-sidebar :deep(.n-menu-item-content:not(.n-menu-item-content--selected):hover) {
  background: var(--bg-hover);
}

.app-sidebar :deep(.n-menu-item-content--selected) {
  background: var(--bg-active) !important;
}

.app-sidebar :deep(.n-menu-item-content--selected)::before {
  transform: translateY(-50%) scaleY(1);
}

/* 悬停时侧边条先出现 */
.app-sidebar :deep(.n-menu-item-content:not(.n-menu-item-content--selected):hover)::before {
  transform: translateY(-50%) scaleY(0.5);
  opacity: 0.5;
}

.app-sidebar :deep(.n-menu-item-content--selected .n-menu-item-content__label) {
  color: var(--accent) !important;
  font-weight: 600;
}

.app-sidebar :deep(.n-menu-item-content--selected .n-menu-item-content__icon) {
  color: var(--accent) !important;
}

/* Footer 呼吸光点效果 */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--c-running);
  box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.18);
  flex-shrink: 0;
  animation: status-pulse 2.5s ease-in-out infinite;
}

@keyframes status-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.18); }
  50%       { box-shadow: 0 0 0 5px rgba(43, 193, 107, 0.08); }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot {
    animation: none;
    box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.18);
  }
}
</style>

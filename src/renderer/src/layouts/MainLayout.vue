<script setup lang="ts">
// PX Dev — Main Layout
// Layered dark sidebar with 7 nav items + main content area.
// Active item uses an accent pill + left accent bar; hover/motion via tokens.

import { computed, h, type VNodeChild, type Component } from 'vue'
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

const router = useRouter()
const route = useRoute()

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
}

.app-sidebar {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-subtle);
}

/* ---- Brand ---- */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 20px 18px;
}

.brand-mark {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: var(--accent-contrast);
  font-weight: 800;
  font-size: 14px;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-accent);
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brand-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.brand-sub {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

/* ---- Nav scroll area ---- */
.sidebar-scroll {
  flex: 1;
  min-height: 0;
  padding-top: 6px;
}

/* ---- Footer ---- */
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border-subtle);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
  background: var(--c-running);
  box-shadow: 0 0 0 3px rgba(43, 193, 107, 0.18);
  flex-shrink: 0;
}

.footer-text {
  font-size: 12px;
  color: var(--text-3);
}

.footer-version {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-4);
  font-family: var(--font-mono);
}

.app-content {
  height: 100vh;
  background: var(--bg-content);
}

/* ---- Menu overrides ---- */
.app-sidebar :deep(.n-menu) {
  padding: 0 10px;
  background: transparent;
}

.app-sidebar :deep(.n-menu-item) {
  margin: 2px 0;
}

.app-sidebar :deep(.n-menu-item-content) {
  border-radius: var(--r-md);
  position: relative;
  transition: background var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
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

.app-sidebar :deep(.n-menu-item-content--selected .n-menu-item-content__label) {
  color: var(--accent) !important;
  font-weight: 600;
}

.app-sidebar :deep(.n-menu-item-content--selected .n-menu-item-content__icon) {
  color: var(--accent) !important;
}
</style>

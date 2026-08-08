// PX Dev — Renderer Router
// 8 routes: dashboard / workspaces / workspaces/:id / services / ports / logs / environment / settings

import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@renderer/views/DashboardView.vue'),
    meta: { title: '仪表盘', icon: 'GridOutline' },
  },
  {
    path: '/workspaces',
    name: 'workspaces',
    component: () => import('@renderer/views/WorkspacesView.vue'),
    meta: { title: '工作区', icon: 'FolderOpenOutline' },
  },
  {
    path: '/workspaces/:id',
    name: 'workspace-detail',
    component: () => import('@renderer/views/WorkspaceDetailView.vue'),
    meta: { title: '工作区详情', hidden: true },
  },
  {
    path: '/services',
    name: 'services',
    component: () => import('@renderer/views/ServicesView.vue'),
    meta: { title: '服务', icon: 'CubeOutline' },
  },
  {
    path: '/ports',
    name: 'ports',
    component: () => import('@renderer/views/PortsView.vue'),
    meta: { title: '端口', icon: 'ServerOutline' },
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('@renderer/views/LogsView.vue'),
    meta: { title: '日志', icon: 'DocumentTextOutline' },
  },
  {
    path: '/environment',
    name: 'environment',
    component: () => import('@renderer/views/EnvironmentView.vue'),
    meta: { title: '环境', icon: 'TerminalOutline' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@renderer/views/SettingsView.vue'),
    meta: { title: '设置', icon: 'SettingsOutline' },
  },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

export default router

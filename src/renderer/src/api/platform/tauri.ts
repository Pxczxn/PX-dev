import { invoke } from '@tauri-apps/api/core'
import { notImplemented } from './types'
import type { PxDevClient } from '@shared/types/client'

/**
 * 创建抛出 NotImplementedError 的命名空间代理
 */
function createNotImplementedNamespace<T>(name: string): T {
  return new Proxy(
    {},
    {
      get: (_, method) => notImplemented(`${name}.${String(method)}`),
    },
  ) as T
}

/**
 * Tauri 适配器：实现完整 PxDevClient 接口
 * Phase 1: system.ping
 * Phase 2: app.getSettings, app.updateSettings, app.getVersion
 * Phase 3: workspace.*, service.*
 */
export function createTauriAdapter(): PxDevClient {
  return {
    system: {
      ping: async () => await invoke<string>('px_ping'),
      openPath: notImplemented('system.openPath'),
      openExternal: notImplemented('system.openExternal'),
      selectDirectory: notImplemented('system.selectDirectory'),
      scanDirectory: notImplemented('system.scanDirectory'),
      showItemInFolder: notImplemented('system.showItemInFolder'),
      detectProject: notImplemented('system.detectProject'),
    },
    app: {
      getSettings: async () => await invoke('get_settings'),
      updateSettings: async (input: Record<string, unknown>) => await invoke('update_settings', { input }),
      getVersion: async () => await invoke<string>('get_app_version'),
      quit: notImplemented('app.quit'),
      minimize: notImplemented('app.minimize'),
      getDataPath: notImplemented('app.getDataPath'),
      selectDataPath: notImplemented('app.selectDataPath'),
    },
    workspace: {
      list: async () => await invoke('list_workspaces'),
      create: async (input: Record<string, unknown>) => await invoke('create_workspace', { input }),
      update: async (input: Record<string, unknown>) => await invoke('update_workspace', { input }),
      delete: async (id: string) => await invoke('delete_workspace', { id }),
      discover: notImplemented('workspace.discover'),
      applyDiscovery: notImplemented('workspace.applyDiscovery'),
      getRuntimeEndpoints: notImplemented('workspace.getRuntimeEndpoints'),
    },
    service: {
      list: async (workspaceId?: string) => await invoke('list_services', { workspaceId }),
      create: async (input: Record<string, unknown>) => await invoke('create_service', { input }),
      update: async (input: Record<string, unknown>) => await invoke('update_service', { input }),
      delete: async (id: string) => await invoke('delete_service', { id }),
    },
    process: {
      start: async (serviceId: string) => await invoke('start_process', { serviceId }),
      stop: async (serviceId: string) => await invoke('stop_process', { serviceId }),
      restart: async (serviceId: string) => await invoke('restart_process', { serviceId }),
      forceKill: async (serviceId: string) => await invoke('force_kill_process', { serviceId }),
      getRuntime: async (serviceId?: string) => await invoke('get_process_runtime', { serviceId }),
      startWorkspace: notImplemented('process.startWorkspace'),
      stopWorkspace: notImplemented('process.stopWorkspace'),
      stopAll: notImplemented('process.stopAll'),
    },
    log: createNotImplementedNamespace('log'),
    environment: createNotImplementedNamespace('environment'),
    port: createNotImplementedNamespace('port'),
    events: createNotImplementedNamespace('events'),
  } as PxDevClient
}

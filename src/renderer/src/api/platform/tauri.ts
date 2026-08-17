import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { notImplemented, NotImplementedError } from './types'
import type { PxDevClient } from '@shared/types/client'
import type { LogEntry, ProcessRuntime } from '@shared/types'

/**
 * Creates a deferred listener wrapper to handle async listen() with sync contract
 * This ensures cleanup happens even if component unmounts before Promise resolves
 */
function createDeferredListener<T>(
  eventName: string,
  callback: (payload: T) => void
): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined

  listen<T>(eventName, (event) => {
    callback(event.payload)
  })
    .then((fn) => {
      if (disposed) {
        fn()
      } else {
        unlisten = fn
      }
    })
    .catch((err) => {
      console.error(`Failed to listen to ${eventName}:`, err)
    })

  return () => {
    disposed = true
    if (unlisten) {
      unlisten()
    }
  }
}

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
      selectDirectory: async () => {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({
          directory: true,
          multiple: false,
        })
        return selected || null
      },
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
    log: {
      subscribe: async (serviceId: string) => {
        await invoke('log_subscribe', { serviceId })
        return { success: true }
      },
      unsubscribe: async (serviceId: string) => {
        await invoke('log_unsubscribe', { serviceId })
        return { success: true }
      },
      clear: async (serviceId: string) => {
        await invoke('log_clear', { serviceId })
        return { success: true }
      },
      history: async (serviceId: string, limit?: number) => 
        await invoke<LogEntry[]>('log_history', { serviceId, limit }),
      export: async (serviceId: string, savePath?: string) => 
        await invoke<{ success: boolean; path?: string }>('log_export', { serviceId, savePath }),
    },
    environment: createNotImplementedNamespace('environment'),
    port: createNotImplementedNamespace('port'),
    events: {
      onLogBatch: (callback) => {
        return createDeferredListener<{ serviceId: string; entries: LogEntry[] }>(
          'log:batch',
          callback
        )
      },
      onRuntimeChanged: (callback) => {
        return createDeferredListener<{ serviceId: string; runtime: ProcessRuntime }>(
          'runtime:changed',
          callback
        )
      },
      onRuntimeEndpoints: () => {
        throw new NotImplementedError('events.onRuntimeEndpoints', 'Phase 6')
      },
    },
  } as PxDevClient
}

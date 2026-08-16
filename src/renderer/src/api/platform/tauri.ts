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
 * Phase 1: 仅实现 system.ping，其他方法抛出 NotImplementedError
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
    workspace: createNotImplementedNamespace('workspace'),
    service: createNotImplementedNamespace('service'),
    process: createNotImplementedNamespace('process'),
    log: createNotImplementedNamespace('log'),
    environment: createNotImplementedNamespace('environment'),
    port: createNotImplementedNamespace('port'),
    app: createNotImplementedNamespace('app'),
    events: createNotImplementedNamespace('events'),
  } as PxDevClient
}

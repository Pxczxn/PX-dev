import type { PxDevClient } from '@shared/types/client'
import { toPlain } from '../serialize'

/**
 * 包装方法，自动对参数应用 toPlain 序列化
 * 函数参数（如回调）直接传递，不序列化
 */
function wrapMethod<T extends (...args: unknown[]) => unknown>(fn: T): T {
  return ((...args: unknown[]) => {
    const plainArgs = args.map((arg) => {
      // 函数参数（事件回调）直接传递
      if (typeof arg === 'function') return arg
      // 其他参数序列化
      return toPlain(arg)
    })
    return fn(...plainArgs)
  }) as T
}

/**
 * Electron 适配器：包装 window.pxDev，应用 toPlain 序列化
 * 返回完整 PxDevClient 接口
 */
export function createElectronAdapter(): PxDevClient {
  if (!window.pxDev) {
    throw new Error('window.pxDev is not available')
  }

  const api = window.pxDev

  return {
    workspace: {
      list: wrapMethod(api.workspace.list),
      create: wrapMethod(api.workspace.create),
      update: wrapMethod(api.workspace.update),
      delete: wrapMethod(api.workspace.delete),
      discover: wrapMethod(api.workspace.discover),
      applyDiscovery: wrapMethod(api.workspace.applyDiscovery),
      getRuntimeEndpoints: wrapMethod(api.workspace.getRuntimeEndpoints),
    },
    service: {
      list: wrapMethod(api.service.list),
      create: wrapMethod(api.service.create),
      update: wrapMethod(api.service.update),
      delete: wrapMethod(api.service.delete),
    },
    process: {
      start: wrapMethod(api.process.start),
      stop: wrapMethod(api.process.stop),
      restart: wrapMethod(api.process.restart),
      forceKill: wrapMethod(api.process.forceKill),
      getRuntime: wrapMethod(api.process.getRuntime),
      startWorkspace: wrapMethod(api.process.startWorkspace),
      stopWorkspace: wrapMethod(api.process.stopWorkspace),
      stopAll: wrapMethod(api.process.stopAll),
    },
    log: {
      subscribe: wrapMethod(api.log.subscribe),
      unsubscribe: wrapMethod(api.log.unsubscribe),
      clear: wrapMethod(api.log.clear),
      history: wrapMethod(api.log.history),
      export: wrapMethod(api.log.export),
    },
    environment: {
      detect: wrapMethod(api.environment.detect),
      detectSingle: wrapMethod(api.environment.detectSingle),
    },
    port: {
      check: wrapMethod(api.port.check),
      owner: wrapMethod(api.port.owner),
      kill: wrapMethod(api.port.kill),
      waitListening: wrapMethod(api.port.waitListening),
    },
    system: {
      // Phase 1: Electron 不实现 ping（可选返回占位字符串）
      ping: async () => 'Electron backend (no ping)',
      openPath: wrapMethod(api.system.openPath),
      openExternal: wrapMethod(api.system.openExternal),
      selectDirectory: wrapMethod(api.system.selectDirectory),
      scanDirectory: wrapMethod(api.system.scanDirectory),
      showItemInFolder: wrapMethod(api.system.showItemInFolder),
      detectProject: wrapMethod(api.system.detectProject),
    },
    app: {
      getSettings: wrapMethod(api.app.getSettings),
      updateSettings: wrapMethod(api.app.updateSettings),
      getVersion: wrapMethod(api.app.getVersion),
      quit: wrapMethod(api.app.quit),
      minimize: wrapMethod(api.app.minimize),
      getDataPath: wrapMethod(api.app.getDataPath),
      selectDataPath: wrapMethod(api.app.selectDataPath),
    },
    events: {
      // 事件回调直接传递，不需要序列化
      onLogBatch: api.events.onLogBatch,
      onRuntimeChanged: api.events.onRuntimeChanged,
      onRuntimeEndpoints: api.events.onRuntimeEndpoints,
    },
  }
}

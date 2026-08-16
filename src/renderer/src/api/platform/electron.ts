import type { PxDevClient } from '@shared/types/client'
import { toPlain } from '../serialize'

/**
 * 包装方法，自动对参数应用 toPlain 序列化
 * 函数参数（如回调）直接传递，不序列化
 * 保留 this binding 以防 contextBridge 代理方法需要绑定
 */
function wrapMethod<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  target: unknown,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    const plainArgs = args.map((arg) => {
      // 函数参数（事件回调）直接传递
      if (typeof arg === 'function') return arg
      // 其他参数序列化
      return toPlain(arg)
    }) as TArgs
    
    // 绑定原命名空间对象，避免 contextBridge 代理方法丢失 this
    return fn.apply(target, plainArgs)
  }
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
      list: wrapMethod(api.workspace.list, api.workspace),
      create: wrapMethod(api.workspace.create, api.workspace),
      update: wrapMethod(api.workspace.update, api.workspace),
      delete: wrapMethod(api.workspace.delete, api.workspace),
      discover: wrapMethod(api.workspace.discover, api.workspace),
      applyDiscovery: wrapMethod(api.workspace.applyDiscovery, api.workspace),
      getRuntimeEndpoints: wrapMethod(api.workspace.getRuntimeEndpoints, api.workspace),
    },
    service: {
      list: wrapMethod(api.service.list, api.service),
      create: wrapMethod(api.service.create, api.service),
      update: wrapMethod(api.service.update, api.service),
      delete: wrapMethod(api.service.delete, api.service),
    },
    process: {
      start: wrapMethod(api.process.start, api.process),
      stop: wrapMethod(api.process.stop, api.process),
      restart: wrapMethod(api.process.restart, api.process),
      forceKill: wrapMethod(api.process.forceKill, api.process),
      getRuntime: wrapMethod(api.process.getRuntime, api.process),
      startWorkspace: wrapMethod(api.process.startWorkspace, api.process),
      stopWorkspace: wrapMethod(api.process.stopWorkspace, api.process),
      stopAll: wrapMethod(api.process.stopAll, api.process),
    },
    log: {
      subscribe: wrapMethod(api.log.subscribe, api.log),
      unsubscribe: wrapMethod(api.log.unsubscribe, api.log),
      clear: wrapMethod(api.log.clear, api.log),
      history: wrapMethod(api.log.history, api.log),
      export: wrapMethod(api.log.export, api.log),
    },
    environment: {
      detect: wrapMethod(api.environment.detect, api.environment),
      detectSingle: wrapMethod(api.environment.detectSingle, api.environment),
    },
    port: {
      check: wrapMethod(api.port.check, api.port),
      owner: wrapMethod(api.port.owner, api.port),
      kill: wrapMethod(api.port.kill, api.port),
      waitListening: wrapMethod(api.port.waitListening, api.port),
    },
    system: {
      // Phase 1: Electron 不实现 ping（可选返回占位字符串）
      ping: async () => 'Electron backend (no ping)',
      openPath: wrapMethod(api.system.openPath, api.system),
      openExternal: wrapMethod(api.system.openExternal, api.system),
      selectDirectory: wrapMethod(api.system.selectDirectory, api.system),
      scanDirectory: wrapMethod(api.system.scanDirectory, api.system),
      showItemInFolder: wrapMethod(api.system.showItemInFolder, api.system),
      detectProject: wrapMethod(api.system.detectProject, api.system),
    },
    app: {
      getSettings: wrapMethod(api.app.getSettings, api.app),
      updateSettings: wrapMethod(api.app.updateSettings, api.app),
      getVersion: wrapMethod(api.app.getVersion, api.app),
      quit: wrapMethod(api.app.quit, api.app),
      minimize: wrapMethod(api.app.minimize, api.app),
      getDataPath: wrapMethod(api.app.getDataPath, api.app),
      selectDataPath: wrapMethod(api.app.selectDataPath, api.app),
    },
    events: {
      // 事件回调直接传递，不需要序列化
      onLogBatch: api.events.onLogBatch,
      onRuntimeChanged: api.events.onRuntimeChanged,
      onRuntimeEndpoints: api.events.onRuntimeEndpoints,
    },
  }
}

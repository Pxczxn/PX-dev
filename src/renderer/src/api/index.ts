// PX Dev — Renderer API Layer
// Thin wrapper around window.pxDev with null-safe access
//
// ⚠️ 跨进程序列化约束（务必阅读）
//
// 窗口开启了 contextIsolation，window.pxDev 是 contextBridge 暴露的对象。
// 当渲染进程「主世界」把实参传给 preload「隔离世界」时，Electron 走
// PassValueToOtherContext()：
//   - 原始类型          → 直接复制
//   - 函数 / Promise    → 代理
//   - 数组 / 纯对象      → 在目标 context 重建（IsPlainObject 明确**排除** Proxy）
//   - 其余（含 JS Proxy）→ 退化到结构化克隆，失败即抛
//                        `An object could not be cloned.`
//
// Vue 的 ref/reactive 返回的都是 Proxy，会命中最后一条 → 直接炸。
// 且该异常发生在**跨 bridge 的瞬间**，preload 里的 ipcRenderer.invoke 根本来不及执行，
// 因此净化只能、且必须发生在渲染进程主世界调用 window.pxDev 之前。
//
// 历史教训：早期靠「每个方法记得手写 toPlain()」来防守，只要新增或漏掉一个方法
// 就会重新引入同一个 bug。现在改为在 getApi() 出口处统一拦截（createGuardedProxy），
// 任何方法（含未来新增的）的任何入参都会被自动净化，不再依赖人为记忆。

import type { LogEntry, ProcessRuntime } from '@shared/types'
import type { PxDevAPI } from '../../../preload/api'
import { toPlain } from './serialize'

/**
 * 净化单个实参。
 *
 * 函数必须原样透传：事件订阅（onLogBatch / onRuntimeChanged）依赖 contextBridge
 * 自身的函数代理机制，若被 toPlain() 处理会变成 undefined，导致订阅静默失效。
 */
function sanitizeArg(arg: unknown): unknown {
  return typeof arg === 'function' ? arg : toPlain(arg)
}

/**
 * 递归包裹 contextBridge 命名空间，使其所有方法在调用前自动净化入参。
 *
 * 该 Proxy 只存在于渲染进程主世界、用于拦截调用，本身不会跨进程传递；
 * 真正送出去的永远是 toPlain() 产出的纯数据。
 */
function createGuardedProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver): unknown {
      const value = Reflect.get(obj, prop, receiver)

      if (typeof value === 'function') {
        const fn = value as (...args: unknown[]) => unknown
        // 绑定原命名空间对象，避免 contextBridge 代理方法丢失 this
        return (...args: unknown[]): unknown => fn.apply(obj, args.map(sanitizeArg))
      }

      // 嵌套命名空间（workspace / service / process ...）继续下沉包裹
      if (value !== null && typeof value === 'object') {
        return createGuardedProxy(value as object)
      }

      return value
    },
  })
}

/** Safe API accessor — returns null if not available (for guards) */
function tryGetApi(): PxDevAPI | null {
  if (typeof window !== 'undefined' && window.pxDev) {
    return window.pxDev
  }
  return null
}

// 缓存包裹结果，避免每次调用都重建 Proxy 链
let rawApiRef: PxDevAPI | null = null
let guardedApiRef: PxDevAPI | null = null

/** Get the pxDev API from the global window object（已带入参净化保护） */
function getApi(): PxDevAPI {
  const raw = tryGetApi()
  if (!raw) {
    // Fallback for SSR or preload not yet loaded
    throw new Error('window.pxDev is not available. Ensure preload script is loaded.')
  }

  if (rawApiRef !== raw || !guardedApiRef) {
    rawApiRef = raw
    guardedApiRef = createGuardedProxy(raw)
  }

  return guardedApiRef
}

export const api = {
  workspace: {
    list: () => getApi().workspace.list(),
    // 入参已由 getApi() 的守卫统一净化；此处显式 toPlain() 作为可读的意图声明与二次保险
    create: (input: Record<string, unknown>) => getApi().workspace.create(toPlain(input)),
    update: (input: Record<string, unknown>) => getApi().workspace.update(toPlain(input)),
    delete: (id: string) => getApi().workspace.delete(id),
  },
  service: {
    list: (workspaceId?: string) => getApi().service.list(workspaceId),
    create: (input: Record<string, unknown>) => getApi().service.create(toPlain(input)),
    update: (input: Record<string, unknown>) => getApi().service.update(toPlain(input)),
    delete: (id: string) => getApi().service.delete(id),
  },
  process: {
    start: (serviceId: string) => getApi().process.start(serviceId),
    stop: (serviceId: string) => getApi().process.stop(serviceId),
    restart: (serviceId: string) => getApi().process.restart(serviceId),
    forceKill: (serviceId: string) => getApi().process.forceKill(serviceId),
    getRuntime: (serviceId?: string) => getApi().process.getRuntime(serviceId),
    startWorkspace: (workspaceId: string) => getApi().process.startWorkspace(workspaceId),
    stopWorkspace: (workspaceId: string) => getApi().process.stopWorkspace(workspaceId),
    stopAll: () => getApi().process.stopAll(),
  },
  log: {
    subscribe: (serviceId: string) => getApi().log.subscribe(serviceId),
    unsubscribe: (serviceId: string) => getApi().log.unsubscribe(serviceId),
    clear: (serviceId: string) => getApi().log.clear(serviceId),
    history: (serviceId: string, limit?: number) => getApi().log.history(serviceId, limit),
    export: (serviceId: string, savePath?: string) => getApi().log.export(serviceId, savePath),
  },
  environment: {
    detect: () => getApi().environment.detect(),
    detectSingle: (name: string) => getApi().environment.detectSingle(name),
  },
  port: {
    check: (port: number) => getApi().port.check(port),
    owner: (port: number) => getApi().port.owner(port),
    kill: (pid: number) => getApi().port.kill(pid),
    waitListening: (port: number, timeoutMs?: number) =>
      getApi().port.waitListening(port, timeoutMs),
  },
  system: {
    openPath: (path: string) => getApi().system.openPath(path),
    openExternal: (url: string) => getApi().system.openExternal(url),
    selectDirectory: () => getApi().system.selectDirectory(),
    scanDirectory: (path: string) => getApi().system.scanDirectory(path),
    showItemInFolder: (path: string) => getApi().system.showItemInFolder(path),
  },
  app: {
    getSettings: () => getApi().app.getSettings(),
    updateSettings: (input: Record<string, unknown>) => getApi().app.updateSettings(toPlain(input)),
    getVersion: () => getApi().app.getVersion(),
    quit: () => getApi().app.quit(),
    minimize: () => getApi().app.minimize(),
  },
  events: {
    onLogBatch: (cb: (payload: { serviceId: string; entries: LogEntry[] }) => void) =>
      getApi().events.onLogBatch(cb),
    onRuntimeChanged: (
      cb: (payload: { serviceId: string; runtime: ProcessRuntime }) => void,
    ) => getApi().events.onRuntimeChanged(cb),
  },
  /** Check if API is available (guard for early render) */
  isAvailable: () => tryGetApi() !== null,
}

// Re-export types for convenience
export type { PxDevAPI }

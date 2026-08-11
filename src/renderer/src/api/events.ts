// PX Dev — Renderer Event Helpers
// Convenience wrappers for log:batch and runtime:changed event subscriptions

import type { LogEntry, ProcessRuntime, RuntimeEndpointSnapshot } from '@shared/types'

// Lazy API accessor (avoid top-level import to prevent premature getApi() call)
function getApi() {
  if (typeof window !== 'undefined' && window.pxDev) {
    return window.pxDev
  }
  throw new Error('window.pxDev is not available. Ensure preload script is loaded.')
}

/**
 * Subscribe to log batch events for a specific service.
 * Returns an unsubscribe function.
 *
 * Usage in setup():
 *   const unsubscribe = onLogBatch((payload) => { ... })
 *   onUnmounted(() => unsubscribe())
 */
export function onLogBatch(
  callback: (serviceId: string, entries: LogEntry[]) => void,
): () => void {
  return getApi().events.onLogBatch((payload) => {
    callback(payload.serviceId, payload.entries)
  })
}

/**
 * Subscribe to runtime change events.
 * Returns an unsubscribe function.
 *
 * Usage in setup():
 *   const unsubscribe = onRuntimeChanged((serviceId, runtime) => { ... })
 *   onUnmounted(() => unsubscribe())
 */
export function onRuntimeChanged(
  callback: (serviceId: string, runtime: ProcessRuntime) => void,
): () => void {
  return getApi().events.onRuntimeChanged((payload) => {
    callback(payload.serviceId, payload.runtime)
  })
}

/**
 * Subscribe to runtime endpoint changes (Phase 6).
 * Returns an unsubscribe function.
 *
 * runtime === null 表示该服务已停止 / 重启，UI 应清空端点展示。
 */
export function onRuntimeEndpoints(
  callback: (serviceId: string, runtime: RuntimeEndpointSnapshot | null) => void,
): () => void {
  return getApi().events.onRuntimeEndpoints((payload) => {
    callback(payload.serviceId, payload.runtime)
  })
}

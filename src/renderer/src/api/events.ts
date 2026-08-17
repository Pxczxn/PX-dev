// PX Dev — Renderer Event Helpers
// Convenience wrappers for log:batch and runtime:changed event subscriptions

import type { LogEntry, ProcessRuntime, RuntimeEndpointSnapshot } from '@shared/types'

// Lazy API accessor using the unified adapter pattern
async function getEventsApi() {
  const { api } = await import('@renderer/api')
  return api.events
}

/**
 * Subscribe to log batch events for a specific service.
 * Returns an unsubscribe function.
 *
 * Usage in setup():
 *   const unsubscribe = onLogBatch((serviceId, entries) => { ... })
 *   onUnmounted(() => unsubscribe())
 */
export function onLogBatch(
  callback: (serviceId: string, entries: LogEntry[]) => void,
): () => void {
  let cleanup: (() => void) | null = null
  
  getEventsApi().then((events) => {
    cleanup = events.onLogBatch((payload) => {
      callback(payload.serviceId, payload.entries)
    })
  }).catch((err) => {
    console.error('Failed to setup log batch listener:', err)
  })
  
  return () => {
    if (cleanup) {
      cleanup()
    }
  }
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
  let cleanup: (() => void) | null = null
  
  getEventsApi().then((events) => {
    cleanup = events.onRuntimeChanged((payload) => {
      callback(payload.serviceId, payload.runtime)
    })
  }).catch((err) => {
    console.error('Failed to setup runtime changed listener:', err)
  })
  
  return () => {
    if (cleanup) {
      cleanup()
    }
  }
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
  let cleanup: (() => void) | null = null
  
  getEventsApi().then((events) => {
    cleanup = events.onRuntimeEndpoints((payload) => {
      callback(payload.serviceId, payload.runtime)
    })
  }).catch((err) => {
    console.error('Failed to setup runtime endpoints listener:', err)
  })
  
  return () => {
    if (cleanup) {
      cleanup()
    }
  }
}

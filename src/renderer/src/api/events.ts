// PX Dev — Renderer Event Helpers
// Convenience wrappers for log:batch and runtime:changed event subscriptions

import { api } from './index'
import type { LogEntry, ProcessRuntime } from '@shared/types'

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
  return api.events.onLogBatch((payload) => {
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
  return api.events.onRuntimeChanged((payload) => {
    callback(payload.serviceId, payload.runtime)
  })
}

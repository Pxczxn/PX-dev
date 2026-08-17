// PX Dev — Log Store
// Per-service log buffer with max line limit; batch append from log:batch events

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { LogEntry } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'
import { logger } from '@renderer/utils/logger'

export const useLogStore = defineStore('log', () => {
  // Map<serviceId, LogEntry[]>
  const buffers = ref<Map<string, LogEntry[]>>(new Map())
  // Subscribed service IDs
  const subscribed = ref<Set<string>>(new Set())
  // Active log tab serviceId
  const activeServiceId = ref<string | null>(null)
  // Max lines per service
  const maxLines = ref(DEFAULT_SETTINGS.maxLogLines)

  let unsubLogBatch: (() => void) | null = null

  // Computed: active service logs
  const activeLogs = computed<LogEntry[]>(() => {
    if (!activeServiceId.value) return []
    return buffers.value.get(activeServiceId.value) ?? []
  })

  /** Get logs for a service */
  function getLogs(serviceId: string): LogEntry[] {
    return buffers.value.get(serviceId) ?? []
  }

  /** Append batch of entries for a service */
  function appendBatch(serviceId: string, entries: LogEntry[]): void {
    let buf = buffers.value.get(serviceId)
    if (!buf) {
      buf = []
      buffers.value.set(serviceId, buf)
    }
    buf.push(...entries)

    // Trim if exceeds max
    if (buf.length > maxLines.value) {
      buf.splice(0, buf.length - maxLines.value)
    }

    // Trigger reactivity
    buffers.value = new Map(buffers.value)
  }

  /** Clear logs for a service */
  function clearLogs(serviceId: string): void {
    buffers.value.set(serviceId, [])
    buffers.value = new Map(buffers.value)
  }

  /** Load history from main process */
  async function loadHistory(serviceId: string, limit?: number): Promise<void> {
    const { api } = await import('@renderer/api')
    try {
      const history = await api.log.history(serviceId, limit)
      
      // Use appendBatch to merge with any entries received during loading
      // This prevents race condition where batch arrives before history returns
      const existing = buffers.value.get(serviceId) || []
      
      // Merge and deduplicate by timestamp (history is older, batch is newer)
      const merged = [...history]
      const historyTimestamps = new Set(history.map(e => e.timestamp))
      
      // Only append entries from existing that aren't in history
      for (const entry of existing) {
        if (!historyTimestamps.has(entry.timestamp)) {
          merged.push(entry)
        }
      }
      
      // Sort by timestamp and apply maxLines limit
      merged.sort((a, b) => a.timestamp - b.timestamp)
      const trimmed = merged.slice(-maxLines.value)
      
      buffers.value.set(serviceId, trimmed)
      buffers.value = new Map(buffers.value)
    } catch (err) {
      logger.error('LogStore', 'Failed to load log history', err)
    }
  }

  /** Subscribe to a service's log stream */
  async function subscribe(serviceId: string): Promise<void> {
    if (subscribed.value.has(serviceId)) return
    
    // Mark as subscribed first to prevent duplicate calls
    subscribed.value.add(serviceId)
    subscribed.value = new Set(subscribed.value)
    
    const { api } = await import('@renderer/api')
    try {
      // Subscribe backend first, then load history
      // This ensures we don't miss any logs during the window
      await api.log.subscribe(serviceId)
      await loadHistory(serviceId, maxLines.value)
    } catch (err) {
      logger.error('LogStore', 'Failed to subscribe to logs', err)
      // Rollback subscription on error
      subscribed.value.delete(serviceId)
      subscribed.value = new Set(subscribed.value)
    }
  }

  /** Unsubscribe from a service's log stream */
  async function unsubscribe(serviceId: string): Promise<void> {
    if (!subscribed.value.has(serviceId)) return
    const { api } = await import('@renderer/api')
    try {
      await api.log.unsubscribe(serviceId)
      subscribed.value.delete(serviceId)
      subscribed.value = new Set(subscribed.value)
    } catch (err) {
      logger.error('LogStore', 'Failed to unsubscribe from logs', err)
    }
  }

  /** Export logs to file */
  async function exportLogs(serviceId: string, savePath?: string): Promise<void> {
    const { api } = await import('@renderer/api')
    await api.log.export(serviceId, savePath)
  }

  /** Set active service for log viewing */
  function setActiveService(serviceId: string | null): void {
    activeServiceId.value = serviceId
  }

  /** Update max lines limit and trim existing buffers */
  function setMaxLines(max: number): void {
    maxLines.value = max
    
    // Trim all existing buffers to new limit
    for (const [serviceId, entries] of buffers.value.entries()) {
      if (entries.length > max) {
        buffers.value.set(serviceId, entries.slice(-max))
      }
    }
    
    // Trigger reactivity
    buffers.value = new Map(buffers.value)
  }

  /** Start listening to log:batch events */
  function startListening(): void {
    if (unsubLogBatch) return

    import('@renderer/api/events').then(({ onLogBatch }) => {
      unsubLogBatch = onLogBatch((serviceId, entries) => {
        appendBatch(serviceId, entries)
      })
    })
  }

  /** Stop listening to log:batch events */
  function stopListening(): void {
    if (unsubLogBatch) {
      unsubLogBatch()
      unsubLogBatch = null
    }
  }

  return {
    buffers,
    subscribed,
    activeServiceId,
    maxLines,
    activeLogs,
    getLogs,
    appendBatch,
    clearLogs,
    loadHistory,
    subscribe,
    unsubscribe,
    exportLogs,
    setActiveService,
    setMaxLines,
    startListening,
    stopListening,
  }
})

// PX Dev — Log Store
// Per-service log buffer with max line limit; batch append from log:batch events

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { LogEntry } from '@shared/types'
import { api } from '@renderer/api'
import { onLogBatch } from '@renderer/api/events'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'

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
    try {
      const history = await api.log.history(serviceId, limit)
      buffers.value.set(serviceId, history)
      buffers.value = new Map(buffers.value)
    } catch (err) {
      console.error('Failed to load log history:', err)
    }
  }

  /** Subscribe to a service's log stream */
  async function subscribe(serviceId: string): Promise<void> {
    if (subscribed.value.has(serviceId)) return
    try {
      await api.log.subscribe(serviceId)
      subscribed.value.add(serviceId)
      subscribed.value = new Set(subscribed.value)
    } catch (err) {
      console.error('Failed to subscribe to logs:', err)
    }
  }

  /** Unsubscribe from a service's log stream */
  async function unsubscribe(serviceId: string): Promise<void> {
    if (!subscribed.value.has(serviceId)) return
    try {
      await api.log.unsubscribe(serviceId)
      subscribed.value.delete(serviceId)
      subscribed.value = new Set(subscribed.value)
    } catch (err) {
      console.error('Failed to unsubscribe from logs:', err)
    }
  }

  /** Export logs to file */
  async function exportLogs(serviceId: string, savePath?: string): Promise<void> {
    await api.log.export(serviceId, savePath)
  }

  /** Set active service for log viewing */
  function setActiveService(serviceId: string | null): void {
    activeServiceId.value = serviceId
  }

  /** Update max lines limit */
  function setMaxLines(max: number): void {
    maxLines.value = max
  }

  /** Start listening to log:batch events */
  function startListening(): void {
    if (unsubLogBatch) return
    unsubLogBatch = onLogBatch((serviceId, entries) => {
      appendBatch(serviceId, entries)
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

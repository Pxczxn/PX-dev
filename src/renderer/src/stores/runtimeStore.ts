// PX Dev — Runtime Store
// Mirror of Main process ProcessRuntime states; auto-syncs via runtime:changed events

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProcessRuntime, ProcessStatus } from '@shared/types'
import { api } from '@renderer/api'
import { onRuntimeChanged } from '@renderer/api/events'

export const useRuntimeStore = defineStore('runtime', () => {
  // Map<serviceId, ProcessRuntime>
  const runtimes = ref<Map<string, ProcessRuntime>>(new Map())
  let unsubRuntimeChanged: (() => void) | null = null

  // Computed: all runtimes as array
  const allRuntimes = computed<ProcessRuntime[]>(() => Array.from(runtimes.value.values()))

  // Computed: running count
  const runningCount = computed(() =>
    allRuntimes.value.filter(
      (r) => r.status === 'running' || r.status === 'starting',
    ).length,
  )

  // Computed: by status
  const byStatus = computed(() => {
    const map = new Map<ProcessStatus, ProcessRuntime[]>()
    for (const rt of runtimes.value.values()) {
      const list = map.get(rt.status) ?? []
      list.push(rt)
      map.set(rt.status, list)
    }
    return map
  })

  /** Get runtime for a single service */
  function getRuntime(serviceId: string): ProcessRuntime | undefined {
    return runtimes.value.get(serviceId)
  }

  /** Update a runtime (called from event listener or manual sync) */
  function updateRuntime(serviceId: string, runtime: ProcessRuntime): void {
    runtimes.value.set(serviceId, runtime)
    // Trigger reactivity
    runtimes.value = new Map(runtimes.value)
  }

  /** Sync all runtimes from main process */
  async function syncAll(): Promise<void> {
    try {
      const result = await api.process.getRuntime()
      const list = Array.isArray(result) ? result : [result]
      runtimes.value.clear()
      for (const rt of list) {
        if (rt && rt.serviceId) {
          runtimes.value.set(rt.serviceId, rt)
        }
      }
      runtimes.value = new Map(runtimes.value)
    } catch (err) {
      console.error('Failed to sync runtimes:', err)
    }
  }

  /** Start listening to runtime:changed events */
  function startListening(): void {
    if (unsubRuntimeChanged) return
    unsubRuntimeChanged = onRuntimeChanged((serviceId, runtime) => {
      updateRuntime(serviceId, runtime)
    })
  }

  /** Stop listening to runtime:changed events */
  function stopListening(): void {
    if (unsubRuntimeChanged) {
      unsubRuntimeChanged()
      unsubRuntimeChanged = null
    }
  }

  return {
    runtimes,
    allRuntimes,
    runningCount,
    byStatus,
    getRuntime,
    updateRuntime,
    syncAll,
    startListening,
    stopListening,
  }
})

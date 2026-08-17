// PX Dev — Runtime Store
// Mirror of Main process ProcessRuntime states; auto-syncs via runtime:changed events
// Phase 6 追加：RuntimeEndpointSnapshot 追踪（纯内存，进程停止即清）

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProcessRuntime, ProcessStatus, RuntimeEndpointSnapshot } from '@shared/types'
import { logger } from '@renderer/utils/logger'

export const useRuntimeStore = defineStore('runtime', () => {
  // Map<serviceId, ProcessRuntime>
  const runtimes = ref<Map<string, ProcessRuntime>>(new Map())
  let unsubRuntimeChanged: (() => void) | null = null

  // Phase 6：运行时端点快照（Map<serviceId, RuntimeEndpointSnapshot>）
  const endpointSnapshots = ref<Map<string, RuntimeEndpointSnapshot>>(new Map())
  let unsubRuntimeEndpoints: (() => void) | null = null

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
    const { api } = await import('@renderer/api')
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
      logger.error('RuntimeStore', 'Failed to sync runtimes', err)
    }
  }

  // ============ Phase 6：运行时端点 ============

  /** 获取某个服务的运行时端点快照 */
  function getEndpointSnapshot(serviceId: string): RuntimeEndpointSnapshot | undefined {
    return endpointSnapshots.value.get(serviceId)
  }

  /**
   * 有效端口：configured 优先，runtime 兜底。
   * 配合 Service 的 port 字段使用时，先取 service.port，缺失时用此方法。
   */
  function getEffectivePort(serviceId: string, configuredPort?: number): number | undefined {
    if (configuredPort) return configuredPort
    return endpointSnapshots.value.get(serviceId)?.runtimePort
  }

  /**
   * 有效 URL：runtime primaryUrl 优先，configured port 兜底拼 localhost。
   * Local 列的统一数据源。
   */
  function getEffectiveUrl(serviceId: string, configuredPort?: number): string | undefined {
    const snapshot = endpointSnapshots.value.get(serviceId)
    if (snapshot?.primaryUrl) return snapshot.primaryUrl
    const port = configuredPort ?? snapshot?.runtimePort
    if (port) return `http://localhost:${port}`
    return undefined
  }

  /** 首选可打开 URL（local → network） */
  function getPrimaryUrl(serviceId: string): string | undefined {
    return endpointSnapshots.value.get(serviceId)?.primaryUrl
  }

  /** 端口冲突提示（runtimePort !== configuredPort 时） */
  function getPortConflict(serviceId: string): { configuredPort: number; runtimePort: number; message: string } | undefined {
    return endpointSnapshots.value.get(serviceId)?.conflict
  }

  /** 窗口刷新后从 Main 拉取全部端点快照（兜底） */
  async function syncEndpoints(): Promise<void> {
    const { api } = await import('@renderer/api')
    try {
      const list = await api.workspace.getRuntimeEndpoints()
      endpointSnapshots.value.clear()
      for (const snap of list) {
        if (snap && snap.serviceId) {
          endpointSnapshots.value.set(snap.serviceId, snap)
        }
      }
      endpointSnapshots.value = new Map(endpointSnapshots.value)
    } catch (err) {
      logger.error('RuntimeStore', 'Failed to sync endpoint snapshots', err)
    }
  }

  /** Start listening to runtime:changed events (Phase 5) */
  function startListening(): void {
    if (unsubRuntimeChanged) return

    import('@renderer/api/events').then(({ onRuntimeChanged }) => {
      unsubRuntimeChanged = onRuntimeChanged((serviceId, runtime) => {
        updateRuntime(serviceId, runtime)
      })
    }).catch((err) => {
      logger.error('RuntimeStore', 'Failed to setup runtime event listeners', err)
    })
  }

  /** Start listening to runtime:endpoints events (Phase 6 - not yet implemented) */
  function startEndpointsListening(): void {
    if (unsubRuntimeEndpoints) return

    // Phase 6: Uncomment when runtime:endpoints is implemented
    // import('@renderer/api/events').then(({ onRuntimeEndpoints }) => {
    //   unsubRuntimeEndpoints = onRuntimeEndpoints((serviceId, snapshot) => {
    //     if (snapshot === null) {
    //       endpointSnapshots.value.delete(serviceId)
    //     } else {
    //       endpointSnapshots.value.set(serviceId, snapshot)
    //     }
    //     endpointSnapshots.value = new Map(endpointSnapshots.value)
    //   })
    // })
  }

  /** Stop listening to events */
  function stopListening(): void {
    if (unsubRuntimeChanged) {
      unsubRuntimeChanged()
      unsubRuntimeChanged = null
    }
    if (unsubRuntimeEndpoints) {
      unsubRuntimeEndpoints()
      unsubRuntimeEndpoints = null
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
    // Phase 6：端点
    endpointSnapshots,
    getEndpointSnapshot,
    getEffectivePort,
    getEffectiveUrl,
    getPrimaryUrl,
    getPortConflict,
    syncEndpoints,
    startListening,
    stopListening,
  }
})

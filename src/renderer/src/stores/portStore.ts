// PX Dev — Port Store
// Port availability checking + owner info

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PortOwner } from '@shared/types'
import { COMMON_PORTS } from '@shared/constants/defaults'
import { logger } from '@renderer/utils/logger'

interface PortCheckResult {
  port: number
  available: boolean
  owner: PortOwner | null
}

export const usePortStore = defineStore('port', () => {
  const results = ref<PortCheckResult[]>([])
  const checking = ref(false)

  /** Check all common ports */
  async function checkCommonPorts(): Promise<void> {
    checking.value = true
    try {
      const { api } = await import('@renderer/api')
      const promises = COMMON_PORTS.map(async (port) => {
        try {
          const { available } = await api.port.check(port)
          let owner: PortOwner | null = null
          if (!available) {
            owner = await api.port.owner(port)
          }
          return { port, available, owner } as PortCheckResult
        } catch {
          return { port, available: false, owner: null } as PortCheckResult
        }
      })
      results.value = await Promise.all(promises)
    } catch (err) {
      logger.error('PortStore', 'Failed to check ports', err)
    } finally {
      checking.value = false
    }
  }

  /** Check a single port */
  async function checkPort(port: number): Promise<PortCheckResult> {
    const { api } = await import('@renderer/api')
    const { available } = await api.port.check(port)
    let owner: PortOwner | null = null
    if (!available) {
      owner = await api.port.owner(port)
    }

    const result = { port, available, owner }
    // Update in results if exists, otherwise add
    const idx = results.value.findIndex((r) => r.port === port)
    if (idx !== -1) {
      results.value[idx] = result
    } else {
      results.value.push(result)
    }
    results.value = [...results.value]

    return result
  }

  /** Kill process by PID */
  async function killProcess(pid: number): Promise<boolean> {
    try {
      const { api } = await import('@renderer/api')
      const { success } = await api.port.kill(pid)
      if (success) {
        // Refresh affected ports
        await checkCommonPorts()
      }
      return success
    } catch (err) {
      logger.error('PortStore', 'Failed to kill process', err)
      return false
    }
  }

  /** Clear results */
  function clearResults(): void {
    results.value = []
  }

  return {
    results,
    checking,
    checkCommonPorts,
    checkPort,
    killProcess,
    clearResults,
  }
})

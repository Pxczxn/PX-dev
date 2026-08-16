// PX Dev — Environment Store
// Caches environment detection results

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EnvironmentInfo, EnvironmentName } from '@shared/types'
import { logger } from '@renderer/utils/logger'

export const useEnvironmentStore = defineStore('environment', () => {
  const environments = ref<EnvironmentInfo[]>([])
  const loading = ref(false)

  /** Detect all environments in parallel */
  async function detectAll(): Promise<void> {
    loading.value = true
    try {
      const { api } = await import('@renderer/api')
      environments.value = await api.environment.detect()
    } catch (err) {
      logger.error('EnvironmentStore', 'Failed to detect environments', err)
      environments.value = []
    } finally {
      loading.value = false
    }
  }

  /** Detect a single environment by name */
  async function detectSingle(name: EnvironmentName): Promise<EnvironmentInfo> {
    try {
      const { api } = await import('@renderer/api')
      const info = await api.environment.detectSingle(name)
      // Update in array
      const idx = environments.value.findIndex((e) => e.name === name)
      if (idx !== -1) {
        environments.value[idx] = info
      } else {
        environments.value.push(info)
      }
      return info
    } catch (err) {
      logger.error('EnvironmentStore', `Failed to detect ${name}`, err)
      throw err
    }
  }

  /** Get a single environment by name */
  function getEnvironment(name: string): EnvironmentInfo | undefined {
    return environments.value.find((e) => e.name === name)
  }

  /** Count of available environments */
  function availableCount(): number {
    return environments.value.filter((e) => e.available).length
  }

  return {
    environments,
    loading,
    detectAll,
    detectSingle,
    getEnvironment,
    availableCount,
  }
})

// PX Dev — Settings Store
// Manages app settings (theme, closeBehavior, maxLogLines, etc.)

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'
import { logger } from '@renderer/utils/logger'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loading = ref(false)

  async function loadSettings(): Promise<void> {
    loading.value = true
    try {
      const { api } = await import('@renderer/api')
      settings.value = await api.app.getSettings()
    } catch (err) {
      logger.error('SettingsStore', 'Failed to load settings', err)
      settings.value = { ...DEFAULT_SETTINGS }
    } finally {
      loading.value = false
    }
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    try {
      const { api } = await import('@renderer/api')
      const updated = await api.app.updateSettings(patch)
      settings.value = updated
    } catch (err) {
      logger.error('SettingsStore', 'Failed to update settings', err)
      throw err
    }
  }

  return {
    settings,
    loading,
    loadSettings,
    updateSettings,
  }
})

// PX Dev — Settings Store
// Manages app settings (theme, closeBehavior, maxLogLines, etc.)

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'
import { api } from '@renderer/api'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loading = ref(false)

  async function loadSettings(): Promise<void> {
    loading.value = true
    try {
      settings.value = await api.app.getSettings()
    } catch (err) {
      console.error('Failed to load settings:', err)
      settings.value = { ...DEFAULT_SETTINGS }
    } finally {
      loading.value = false
    }
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    try {
      const updated = await api.app.updateSettings(patch)
      settings.value = updated
    } catch (err) {
      console.error('Failed to update settings:', err)
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

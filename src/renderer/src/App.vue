<script setup lang="ts">
// PX Dev — Root Component
// NConfigProvider + NMessageProvider + NDialogProvider + NLoadingBarProvider + RouterView
// Theme is adaptive: dark / light / system. Both Naive UI and the custom
// design tokens (CSS vars under [data-theme]) switch together.

import { computed, onMounted, watch } from 'vue'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NLoadingBarProvider,
  darkTheme,
  lightTheme,
  zhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import MainLayout from './layouts/MainLayout.vue'
import { useSettingsStore } from './stores/settingsStore'
import { isTauri } from './platform/detect'

const settingsStore = useSettingsStore()

// Resolve the effective theme (handles 'system')
function resolveTheme(): 'dark' | 'light' {
  const pref = settingsStore.settings.theme
  if (pref === 'light') return 'light'
  if (pref === 'dark') return 'dark'
  // system
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }
  return 'dark'
}

const effectiveTheme = computed(resolveTheme)

// Naive UI theme object
const theme = computed(() => (effectiveTheme.value === 'dark' ? darkTheme : lightTheme))

// Sync the data-theme attribute so our CSS custom properties follow Naive
const themeOverrides = computed<GlobalThemeOverrides>(() => {
  const dark = effectiveTheme.value === 'dark'
  return {
    common: {
      primaryColor: '#2b8cff',
      primaryColorHover: '#4ba0ff',
      primaryColorPressed: '#1f6fe0',
      primaryColorSuppl: '#4ba0ff',
      bodyColor: dark ? '#0e0f16' : '#f4f5f7',
      cardColor: dark ? '#16181f' : '#ffffff',
      modalColor: dark ? '#16181f' : '#ffffff',
      popoverColor: dark ? '#1c1f29' : '#ffffff',
      tableColor: dark ? '#16181f' : '#ffffff',
      tableHeaderColor: dark ? '#1c1f29' : '#f0f2f5',
      borderColor: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.10)',
      dividerColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      textColorBase: dark ? '#e8eaed' : '#1a1d23',
      textColor1: dark ? '#e8eaed' : '#1a1d23',
      textColor2: dark ? '#aab0bd' : '#4a5160',
      textColor3: dark ? '#6b7180' : '#7a828f',
      textColor4: dark ? '#4a4f5c' : '#a4abb6',
      borderRadius: '10',
    },
  }
})

// Keep <html data-theme> in sync
watch(
  effectiveTheme,
  (t) => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', t)
    }
  },
  { immediate: true },
)

// React to OS theme changes when 'system'
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (settingsStore.settings.theme === 'system') {
      document.documentElement.setAttribute('data-theme', resolveTheme())
    }
  })
}

onMounted(async () => {
  await settingsStore.loadSettings()

  // Phase 1: Tauri smoke test（仅开发模式，严格断言）
  if (process.env.NODE_ENV === 'development' && isTauri()) {
    try {
      const { api } = await import('@renderer/api')

      // 严格检查 ping 方法存在
      if (!api.system.ping) {
        throw new Error('Tauri system.ping adapter is not wired')
      }

      // 调用并断言返回值
      const response = await api.system.ping()

      if (response !== 'PX Dev Tauri backend ready') {
        throw new Error(`Unexpected ping response: ${response}`)
      }

      console.log('[Tauri Smoke Test] ✓', response)
    } catch (error) {
      console.error('[Tauri Smoke Test] ✗', error)
    }
  }
})
</script>

<template>
  <NConfigProvider :theme="theme" :theme-overrides="themeOverrides" :locale="zhCN">
    <NLoadingBarProvider>
      <NMessageProvider>
        <NDialogProvider>
          <MainLayout />
        </NDialogProvider>
      </NMessageProvider>
    </NLoadingBarProvider>
  </NConfigProvider>
</template>

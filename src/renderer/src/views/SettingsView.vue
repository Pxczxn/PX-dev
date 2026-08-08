<script setup lang="ts">
// PX Dev — SettingsView
// 5 groups: General / Appearance / Startup / Logs / Browser

import { onMounted, ref, toRaw } from 'vue'
import {
  NCard,
  NForm,
  NFormItem,
  NSelect,
  NSwitch,
  NInputNumber,
  NInput,
  NButton,
  NSpace,
  useMessage,
} from 'naive-ui'
import type { Settings } from '@shared/types'
import { useSettingsStore } from '@renderer/stores/settingsStore'

const message = useMessage()
const settingsStore = useSettingsStore()

const themeOptions = [
  { label: '深色', value: 'dark' },
  { label: '浅色', value: 'light' },
  { label: '跟随系统', value: 'system' },
]

const closeBehaviorOptions = [
  { label: '最小化到托盘', value: 'tray' },
  { label: '直接退出', value: 'quit' },
  { label: '询问', value: 'ask' },
]

onMounted(async () => {
  await settingsStore.loadSettings()
})

const saving = ref(false)

async function handleSave(): Promise<void> {
  if (saving.value) {
    return
  }
  saving.value = true
  try {
    // settingsStore.settings 是 Vue 响应式对象，直接跨 IPC 传递会导致
    // 结构化克隆失败；这里用 toRaw + 显式解构生成纯数据快照。
    const raw = toRaw(settingsStore.settings)
    const payload: Settings = {
      theme: raw.theme,
      closeBehavior: raw.closeBehavior,
      maxLogLines: raw.maxLogLines,
      startMinimized: raw.startMinimized,
      autoRestoreLastSession: raw.autoRestoreLastSession,
      startupInterval: raw.startupInterval,
      showTimestamp: raw.showTimestamp,
      defaultBrowser: raw.defaultBrowser,
    }
    await settingsStore.updateSettings(payload)
    message.success('设置已保存')
  } catch (err) {
    console.error('[SettingsView] save failed:', err)
    message.error(formatSaveError(err))
  } finally {
    saving.value = false
  }
}

/** 将保存异常转换为对用户友好、同时保留调试信息的提示文案 */
function formatSaveError(err: unknown): string {
  if (!(err instanceof Error)) {
    return `保存失败：${String(err)}`
  }
  // 结构化克隆失败通常意味着又有响应式对象泄漏到了 IPC 层
  if (err.message.includes('could not be cloned')) {
    return '保存失败：设置数据无法序列化，请重启应用后重试（详见控制台日志）'
  }
  return `保存失败：${err.message}`
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">设置</h2>
      <NButton type="primary" :loading="saving" @click="handleSave">保存设置</NButton>
    </div>

    <NSpace vertical :size="16">
      <!-- General -->
      <NCard title="通用" size="small" :bordered="false">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="关闭行为">
            <NSelect
              v-model:value="settingsStore.settings.closeBehavior"
              :options="closeBehaviorOptions"
              style="width: 240px;"
            />
          </NFormItem>
        </NForm>
      </NCard>

      <!-- Appearance -->
      <NCard title="外观" size="small" :bordered="false">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="主题">
            <NSelect
              v-model:value="settingsStore.settings.theme"
              :options="themeOptions"
              style="width: 240px;"
            />
          </NFormItem>
          <NFormItem label="显示时间戳">
            <NSwitch v-model:value="settingsStore.settings.showTimestamp" />
          </NFormItem>
        </NForm>
      </NCard>

      <!-- Startup -->
      <NCard title="启动" size="small" :bordered="false">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="启动后最小化">
            <NSwitch v-model:value="settingsStore.settings.startMinimized" />
          </NFormItem>
          <NFormItem label="恢复上次会话">
            <NSwitch v-model:value="settingsStore.settings.autoRestoreLastSession" />
          </NFormItem>
          <NFormItem label="服务启动间隔 (ms)">
            <NInputNumber
              v-model:value="settingsStore.settings.startupInterval"
              :min="0"
              :max="30000"
              :step="500"
              style="width: 200px;"
            />
          </NFormItem>
        </NForm>
      </NCard>

      <!-- Logs -->
      <NCard title="日志" size="small" :bordered="false">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="最大日志行数">
            <NInputNumber
              v-model:value="settingsStore.settings.maxLogLines"
              :min="500"
              :max="50000"
              :step="500"
              style="width: 200px;"
            />
          </NFormItem>
        </NForm>
      </NCard>

      <!-- Browser -->
      <NCard title="浏览器" size="small" :bordered="false">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="默认浏览器">
            <NInput
              v-model:value="settingsStore.settings.defaultBrowser"
              placeholder="system 或浏览器路径"
              style="width: 300px;"
            />
          </NFormItem>
        </NForm>
      </NCard>
    </NSpace>
  </div>
</template>

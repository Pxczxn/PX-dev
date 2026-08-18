<script setup lang="ts">
// PX Dev — SettingsView
// 5 groups: General / Appearance / Startup / Logs / Browser / Data

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
  NText,
  NButtonGroup,
} from 'naive-ui'
import type { Settings } from '@shared/types'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { api } from '@renderer/api'
import { logger } from '@renderer/utils/logger'

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

const currentDataPath = ref<string>('')

onMounted(async () => {
  await settingsStore.loadSettings()
  try {
    currentDataPath.value = await api.app.getDataPath()
  } catch {
    currentDataPath.value = ''
  }
})

const saving = ref(false)
const changingDataPath = ref(false)
const notificationEnabled = ref(localStorage.getItem('px-dev:notify-enabled') !== '0')

async function handleSelectDataPath(): Promise<void> {
  if (changingDataPath.value) return
  changingDataPath.value = true
  try {
    const result = await api.app.selectDataPath()
    if (result.success) {
      message.success('数据目录已更改，应用将重启...')
    } else if (result.reason === 'cancelled') {
      // user cancelled
    } else if (result.reason === 'same') {
      message.info('已选择相同的路径，无需更改')
    }
  } catch (err) {
    message.error(`更改数据目录失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    changingDataPath.value = false
  }
}

async function handleOpenDataPath(): Promise<void> {
  if (!currentDataPath.value) return
  try {
    await api.system.openPath(currentDataPath.value)
  } catch {
    message.error('无法打开目录')
  }
}

async function handleSave(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
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
    logger.error('SettingsView', 'Failed to save settings', err)
    message.error(formatSaveError(err))
  } finally {
    saving.value = false
  }
}

function formatSaveError(err: unknown): string {
  if (!(err instanceof Error)) {
    return `保存失败：${String(err)}`
  }
  if (err.message.includes('could not be cloned')) {
    return '保存失败：设置数据无法序列化，请重启应用后重试'
  }
  return `保存失败：${err.message}`
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">设置</h2>
      <NButton type="primary" :loading="saving" @click="handleSave">
        保存设置
      </NButton>
    </div>

    <!-- 设置卡片网格 -->
    <div class="settings-grid">
      <!-- 通用 -->
      <NCard title="通用" size="small" :bordered="false" class="settings-card">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="关闭行为">
            <NSelect
              v-model:value="settingsStore.settings.closeBehavior"
              :options="closeBehaviorOptions"
              style="width: 240px;"
            />
          </NFormItem>
          <NFormItem label="系统通知">
            <NSwitch
              :value="notificationEnabled"
              @update:value="(v: boolean) => {
                notificationEnabled = v
                localStorage.setItem('px-dev:notify-enabled', v ? '1' : '0')
              }"
            />
            <span class="form-hint">服务启动失败或停止时发送通知</span>
          </NFormItem>
        </NForm>
      </NCard>

      <!-- 外观 -->
      <NCard title="外观" size="small" :bordered="false" class="settings-card">
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

      <!-- 启动 -->
      <NCard title="启动" size="small" :bordered="false" class="settings-card">
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

      <!-- 日志 -->
      <NCard title="日志" size="small" :bordered="false" class="settings-card">
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

      <!-- 浏览器 -->
      <NCard title="浏览器" size="small" :bordered="false" class="settings-card">
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

      <!-- 数据 -->
      <NCard title="数据" size="small" :bordered="false" class="settings-card">
        <NForm label-placement="left" :label-width="140">
          <NFormItem label="数据存放目录">
            <NText
              v-if="currentDataPath"
              depth="3"
              style="word-break: break-all; max-width: 400px; display: block; margin-bottom: 8px; font-size: 12px;"
            >
              {{ currentDataPath }}
            </NText>
            <NButtonGroup>
              <NButton size="small" :loading="changingDataPath" @click="handleSelectDataPath">
                更改目录
              </NButton>
              <NButton v-if="currentDataPath" size="small" @click="handleOpenDataPath">
                打开目录
              </NButton>
            </NButtonGroup>
          </NFormItem>
        </NForm>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
/* 设置页面网格布局 */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: var(--sp-4);
}

.settings-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  transition:
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}

.settings-card:hover {
  border-color: var(--border-default);
  box-shadow: var(--glow-sm);
}

/* 表单项辅助说明文字 */
.form-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-4);
  user-select: none;
}
</style>

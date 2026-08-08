<script setup lang="ts">
// PX Dev — WorkspaceCreateModal
// Simple workspace creation form

import { ref, toRaw, watch } from 'vue'
import {
  NModal,
  NForm,
  NFormItem,
  NInput,
  NInputGroup,
  NSelect,
  NSwitch,
  NButton,
  NSpace,
  useMessage,
} from 'naive-ui'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { api } from '@renderer/api'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()
const workspaceStore = useWorkspaceStore()

const form = ref({
  name: '',
  description: '',
  rootPath: '',
  color: '#2b8cff',
  favorite: false,
  startMode: 'parallel' as 'parallel' | 'sequential' | 'dependency',
})

const saving = ref(false)
// 目录选择对话框是否正在打开（防止重复点击）
const selectingDir = ref(false)

const colorOptions = [
  { label: '蓝色', value: '#2b8cff' },
  { label: '绿色', value: '#2bc16b' },
  { label: '橙色', value: '#f5a524' },
  { label: '红色', value: '#f2545b' },
  { label: '紫色', value: '#8b5cf6' },
  { label: '青色', value: '#06b6d4' },
]

const startModeOptions = [
  { label: '并行启动', value: 'parallel' },
  { label: '顺序启动', value: 'sequential' },
  { label: '依赖启动', value: 'dependency' },
]

// Reset form when modal opens
watch(
  () => props.show,
  (show) => {
    if (show) {
      form.value = {
        name: '',
        description: '',
        rootPath: '',
        color: '#2b8cff',
        favorite: false,
        startMode: 'parallel',
      }
    }
  },
)

/**
 * 打开系统原生文件夹选择对话框，将选中的目录填入「根目录」输入框。
 * 用户取消选择时（返回 null）保持当前输入不变；手动输入方式依旧可用。
 */
async function handleSelectRootPath(): Promise<void> {
  if (selectingDir.value) return

  selectingDir.value = true
  try {
    const path = await api.system.selectDirectory()
    if (!path) return

    form.value.rootPath = path
    // 名称为空时用所选目录名自动填充，减少手工输入
    if (!form.value.name.trim()) {
      const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
      form.value.name = segments[segments.length - 1] ?? ''
    }
  } catch (err) {
    message.error('选择目录失败')
    console.error(err)
  } finally {
    selectingDir.value = false
  }
}

/**
 * 由表单生成可跨 IPC 传输的纯数据 payload。
 *
 * 两个要点：
 * 1. form.value 是 Vue 的 reactive Proxy，直接跨 contextBridge 会抛
 *    `An object could not be cloned.`，必须先 toRaw + 显式取值拍平；
 * 2. rootPath 在 Zod 中是 `z.string().min(1).optional()`，
 *    留空时必须**省略该字段**而不是传空串，否则会被判定为参数校验失败。
 */
function buildCreatePayload(): Record<string, unknown> {
  const raw = toRaw(form.value)

  const payload: Record<string, unknown> = {
    name: raw.name.trim(),
    color: raw.color,
    favorite: raw.favorite,
    startMode: raw.startMode,
  }

  const description = raw.description.trim()
  if (description) {
    payload.description = description
  }

  const rootPath = raw.rootPath.trim()
  if (rootPath) {
    payload.rootPath = rootPath
  }

  return payload
}

/** 将创建异常转换为对用户友好、同时保留调试信息的提示文案 */
function formatCreateError(err: unknown): string {
  if (!(err instanceof Error)) {
    return `创建失败：${String(err)}`
  }
  // 结构化克隆失败意味着又有响应式对象泄漏到了 IPC 层
  if (err.message.includes('could not be cloned')) {
    return '创建失败：表单数据无法序列化，请重启应用后重试（详见控制台日志）'
  }
  return `创建失败：${err.message}`
}

async function handleSave(): Promise<void> {
  if (saving.value) {
    return
  }
  if (!form.value.name.trim()) {
    message.warning('请输入工作区名称')
    return
  }

  saving.value = true
  try {
    await workspaceStore.createWorkspace(buildCreatePayload())
    message.success('工作区已创建')
    emit('update:show', false)
  } catch (err) {
    console.error('[WorkspaceCreateModal] create failed:', err)
    message.error(formatCreateError(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v) => emit('update:show', v)"
    preset="card"
    title="创建工作区"
    style="width: 480px;"
    :bordered="false"
  >
    <NForm label-placement="top">
      <NFormItem label="工作区名称" required>
        <NInput v-model:value="form.name" placeholder="例如：我的项目" />
      </NFormItem>

      <NFormItem label="描述">
        <NInput
          v-model:value="form.description"
          type="textarea"
          :rows="2"
          placeholder="工作区描述（可选）"
        />
      </NFormItem>

      <NFormItem label="根目录">
        <!-- 输入框 + 浏览按钮：既支持手动输入，也支持原生文件夹选择 -->
        <NInputGroup>
          <NInput v-model:value="form.rootPath" placeholder="工作区根路径（可选）" />
          <NButton :loading="selectingDir" @click="handleSelectRootPath">
            <template #icon><FolderOpenOutline /></template>
            浏览
          </NButton>
        </NInputGroup>
      </NFormItem>

      <NFormItem label="颜色标识">
        <NSelect v-model:value="form.color" :options="colorOptions" />
      </NFormItem>

      <NFormItem label="启动模式">
        <NSelect v-model:value="form.startMode" :options="startModeOptions" />
      </NFormItem>

      <NFormItem label="收藏">
        <NSwitch v-model:value="form.favorite" />
      </NFormItem>
    </NForm>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" @click="handleSave" :loading="saving">创建</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<script setup lang="ts">
// PX Dev — ServiceEditDrawer
// Complete service form with directory scan + advanced shell mode

import { ref, watch, computed } from 'vue'
import {
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NInputNumber,
  NSwitch,
  NButton,
  NSpace,
  NCollapse,
  NCollapseItem,
  NDynamicTags,
  useMessage,
  type FormRules,
} from 'naive-ui'
import { FolderOpenOutline, ScanOutline } from '@vicons/ionicons5'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { api } from '@renderer/api'
import { formatIpcError } from '@renderer/api/errors'
import { buildServicePayload } from './servicePayload'
import type { Service, HealthCheckConfig } from '@shared/types'
import { logger } from '@renderer/utils/logger'

// Form data interface (for create/edit)
interface ServiceFormData {
  workspaceId: string
  name: string
  type: 'frontend' | 'node' | 'java' | 'generic'
  role: 'frontend' | 'backend'
  cwd: string
  command: string
  args?: string[]
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'custom'
  port?: number | null
  env?: Record<string, string>
  envFile?: string
  enabled: boolean
  dependencies?: string[]
  startupDelay?: number | null
  autoOpenBrowser?: boolean
  openUrl?: string
  healthCheck?: HealthCheckConfig
  shellMode?: boolean
}

const props = defineProps<{
  show: boolean
  service: Service | null
  workspaceId: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const message = useMessage()
const workspaceStore = useWorkspaceStore()
const formRef = ref<InstanceType<typeof NForm> | null>(null)

const form = ref<ServiceFormData>({
  workspaceId: '',
  name: '',
  type: 'node',
  role: 'backend',
  cwd: '',
  command: '',
  enabled: true,
  shellMode: false,
  healthCheck: { type: 'none' },
})
const saving = ref(false)
const scanning = ref(false)
// 选择目录时的重入锁 + 失败冷却，与 WorkspaceCreateModal.handleSelectRootPath 对齐，
// 避免失败瞬间连点刷出多条无信息量的「选择目录失败」
const selectingDir = ref(false)
const SELECT_DIR_FAIL_COOLDOWN_MS = 800

const serviceTypes = [
  { label: '前端', value: 'frontend' },
  { label: 'Node', value: 'node' },
  { label: 'Java', value: 'java' },
  { label: '通用', value: 'generic' },
]

const serviceRoles = [
  { label: '前端', value: 'frontend' },
  { label: '后端', value: 'backend' },
]

const packageManagers = [
  { label: 'npm', value: 'npm' },
  { label: 'pnpm', value: 'pnpm' },
  { label: 'yarn', value: 'yarn' },
  { label: 'bun', value: 'bun' },
  { label: '自定义', value: 'custom' },
]

const healthCheckTypes = [
  { label: '无', value: 'none' },
  { label: '端口', value: 'port' },
  { label: 'HTTP', value: 'http' },
]

const isEdit = computed(() => props.service !== null)

// ============ Inline Validation ============
const formRules: FormRules = {
  name: {
    required: true,
    message: '请输入服务名称',
    trigger: ['blur', 'input'],
  },
  cwd: {
    required: true,
    message: '请选择或输入工作目录',
    trigger: ['blur', 'input'],
  },
  command: {
    required: true,
    message: '请输入启动命令',
    trigger: ['blur', 'input'],
  },
  openUrl: [
    {
      validator: (_rule: unknown, value: string) => {
        if (form.value.autoOpenBrowser && value && !value.trim()) {
          return new Error('请输入有效的 URL')
        }
        return true
      },
      trigger: ['blur', 'input'],
    },
  ],
}

// Initialize form when drawer opens
watch(
  () => props.show,
  (show) => {
    if (show) {
      if (props.service) {
        // Edit mode: copy service data
        form.value = { ...props.service } as ServiceFormData
      } else {
        // Create mode: default values
        form.value = {
          workspaceId: props.workspaceId,
          name: '',
          type: 'node',
          role: 'backend',
          cwd: '',
          command: '',
          args: [],
          enabled: true,
          dependencies: [],
          shellMode: false,
          healthCheck: { type: 'none' } as HealthCheckConfig,
        }
      }
    }
  },
)

async function selectDirectory(): Promise<void> {
  // 防重入：与 WorkspaceCreateModal 一致，按钮loading态也依赖该标志
  if (selectingDir.value) return
  selectingDir.value = true
  try {
    const path = await api.system.selectDirectory()
    if (path) {
      form.value.cwd = path
      // Auto-scan the directory
      await scanDirectory(path)
    }
  } catch (err) {
    logger.error('ServiceEditDrawer', 'Failed to select directory', err)
    message.error(formatIpcError(err, '选择目录失败'))
    // 失败冷却：避免瞬时连点刷出多条无信息量提示
    await new Promise((resolve) => setTimeout(resolve, SELECT_DIR_FAIL_COOLDOWN_MS))
  } finally {
    selectingDir.value = false
  }
}

async function scanDirectory(path?: string): Promise<void> {
  const dirPath = path ?? form.value.cwd
  if (!dirPath) return

  scanning.value = true
  try {
    const result = await api.system.scanDirectory(dirPath)
    if (result.type !== 'unknown') {
      // Auto-fill command and args
      if (result.recommendedCommand) {
        form.value.command = result.recommendedCommand
      }
      if (result.recommendedArgs?.length) {
        form.value.args = result.recommendedArgs
      }
      if (result.packageManager) {
        form.value.packageManager = result.packageManager as 'npm' | 'pnpm' | 'yarn' | 'bun' | 'custom'
      }
      if (result.detectedPort) {
        form.value.port = result.detectedPort
      }
      // Auto-fill name if empty
      if (!form.value.name) {
        const parts = dirPath.replace(/\\/g, '/').split('/')
        form.value.name = parts[parts.length - 1] || 'Service'
      }
      message.success(`检测到 ${result.type} 项目`)
    } else {
      message.info('未检测到已知项目类型')
    }
  } catch (err) {
    logger.error('ServiceEditDrawer', 'Failed to scan directory', err)
    message.error('扫描失败')
  } finally {
    scanning.value = false
  }
}

/** 将保存异常转换为对用户友好、同时保留调试线索的提示文案 */
function formatSaveError(err: unknown): string {
  if (!(err instanceof Error)) {
    return `保存失败：${String(err)}`
  }
  // 结构化克隆失败意味着又有响应式对象泄漏到了 IPC 层
  if (err.message.includes('could not be cloned')) {
    return '保存失败：表单数据无法序列化，请重启应用后重试（详见控制台日志）'
  }
  return `保存失败：${err.message}`
}

async function handleSave(): Promise<void> {
  // 防重入：保存请求是异步的，双击按钮会导致重复创建 / 重复更新
  if (saving.value) {
    return
  }

  // Inline form validation
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  saving.value = true
  try {
    // create / update 共用同一个规范化 builder：
    // 既剥离 Vue 响应式代理，也把「填了又清空」的可选字段省略掉，
    // 避免 openUrl='' / envFile='' / port='' 被 Zod 判定为非法参数。
    if (isEdit.value && props.service) {
      await workspaceStore.updateService(buildServicePayload(form.value, { id: props.service.id }))
      message.success('服务已更新')
    } else {
      const payload = buildServicePayload(form.value)
      // 兜底：表单初始化时若未带上 workspaceId，用 props 补齐
      if (!payload.workspaceId) {
        payload.workspaceId = props.workspaceId
      }
      await workspaceStore.createService(payload)
      message.success('服务已创建')
    }
    emit('saved')
    emit('update:show', false)
  } catch (err) {
    logger.error('ServiceEditDrawer', 'Failed to save service', err)
    message.error(formatSaveError(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NDrawer
    :show="show"
    :width="520"
    @update:show="(v) => emit('update:show', v)"
  >
    <NDrawerContent :title="isEdit ? '编辑服务' : '添加服务'" closable>
      <NForm
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-placement="top"
      >
        <NCollapse :default-expanded-names="['basic']" accordion>
          <!-- 基本信息 -->
          <NCollapseItem title="基本信息" name="basic">
            <NFormItem path="name" label="服务名称" required>
              <NInput v-model:value="form.name" placeholder="例如：前端开发服务器" />
            </NFormItem>

            <NFormItem label="服务类型" required>
              <NSelect v-model:value="form.type" :options="serviceTypes" />
            </NFormItem>

            <NFormItem label="角色分类" required>
              <NSelect v-model:value="form.role" :options="serviceRoles" />
            </NFormItem>

            <NFormItem path="cwd" label="工作目录" required>
              <NSpace>
                <NInput
                  v-model:value="form.cwd"
                  placeholder="选择或输入项目目录"
                  style="width: 340px;"
                />
                <NButton @click="selectDirectory" :loading="selectingDir" quaternary>
                  <template #icon><FolderOpenOutline /></template>
                </NButton>
                <NButton
                  v-if="form.cwd"
                  @click="scanDirectory()"
                  :loading="scanning"
                  quaternary
                >
                  <template #icon><ScanOutline /></template>
                </NButton>
              </NSpace>
            </NFormItem>

            <NFormItem path="command" label="启动命令" required>
              <NInput v-model:value="form.command" placeholder="例如：npm / pnpm / mvn" />
            </NFormItem>

            <NFormItem label="参数">
              <NDynamicTags v-model:value="form.args" :max="20" />
            </NFormItem>
          </NCollapseItem>

          <!-- 运行配置 -->
          <NCollapseItem title="运行配置" name="runtime">
            <NFormItem label="包管理器">
              <NSelect v-model:value="form.packageManager" :options="packageManagers" clearable />
            </NFormItem>

            <NFormItem label="端口">
              <NInputNumber
                v-model:value="form.port"
                :min="1"
                :max="65535"
                placeholder="服务监听端口"
                style="width: 200px;"
              />
            </NFormItem>

            <NFormItem label="启用">
              <NSwitch v-model:value="form.enabled" />
            </NFormItem>

            <NFormItem label="启动延迟 (ms)">
              <NInputNumber
                v-model:value="form.startupDelay"
                :min="0"
                :max="60000"
                :step="500"
                placeholder="服务启动延迟时间"
                style="width: 200px;"
              />
            </NFormItem>
          </NCollapseItem>

          <!-- 高级选项 -->
          <NCollapseItem title="高级选项" name="advanced">
            <NFormItem label="自动打开浏览器">
              <NSwitch v-model:value="form.autoOpenBrowser" />
            </NFormItem>

            <NFormItem v-if="form.autoOpenBrowser" path="openUrl" label="打开 URL">
              <NInput v-model:value="form.openUrl" placeholder="http://localhost:3000" />
            </NFormItem>

            <NFormItem label="Shell 模式">
              <NSwitch v-model:value="form.shellMode" />
              <span style="margin-left: var(--sp-2); font-size: 12px; color: var(--text-4);">
                启用后命令将在 shell 中执行（不推荐，默认折叠为 structured 模式）
              </span>
            </NFormItem>

            <NFormItem label="健康检查类型">
              <NSelect
                :value="(form.healthCheck as HealthCheckConfig | undefined)?.type ?? 'none'"
                :options="healthCheckTypes"
                @update:value="(v) => {
                  form.healthCheck = { ...(form.healthCheck as HealthCheckConfig ?? {}), type: v }
                }"
              />
            </NFormItem>

            <NFormItem
              v-if="(form.healthCheck as HealthCheckConfig | undefined)?.type === 'http'"
              label="健康检查 URL"
            >
              <NInput
                :value="(form.healthCheck as HealthCheckConfig | undefined)?.target"
                placeholder="http://localhost:3000/health"
                @update:value="(v) => {
                  form.healthCheck = { ...(form.healthCheck as HealthCheckConfig ?? {}), target: v }
                }"
              />
            </NFormItem>

            <NFormItem
              v-if="(form.healthCheck as HealthCheckConfig | undefined)?.type === 'port'"
              label="健康检查端口"
            >
              <NInput
                :value="(form.healthCheck as HealthCheckConfig | undefined)?.target"
                placeholder="3000"
                @update:value="(v) => {
                  form.healthCheck = { ...(form.healthCheck as HealthCheckConfig ?? {}), target: v }
                }"
              />
            </NFormItem>
          </NCollapseItem>
        </NCollapse>
      </NForm>

      <template #footer>
        <NSpace>
          <NButton @click="emit('update:show', false)">取消</NButton>
          <NButton type="primary" @click="handleSave" :loading="saving">保存</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

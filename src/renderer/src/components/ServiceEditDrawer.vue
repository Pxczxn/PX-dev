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
} from 'naive-ui'
import { FolderOpenOutline, ScanOutline } from '@vicons/ionicons5'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { api } from '@renderer/api'
import type { Service, HealthCheckConfig } from '@shared/types'

// Form data interface (for create/edit)
interface ServiceFormData {
  workspaceId: string
  name: string
  type: 'frontend' | 'node' | 'java' | 'generic'
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

const form = ref<ServiceFormData>({
  workspaceId: '',
  name: '',
  type: 'node',
  cwd: '',
  command: '',
  enabled: true,
  shellMode: false,
  healthCheck: { type: 'none' },
})
const saving = ref(false)
const scanning = ref(false)

const serviceTypes = [
  { label: '前端', value: 'frontend' },
  { label: 'Node', value: 'node' },
  { label: 'Java', value: 'java' },
  { label: '通用', value: 'generic' },
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
  try {
    const path = await api.system.selectDirectory()
    if (path) {
      form.value.cwd = path
      // Auto-scan the directory
      await scanDirectory(path)
    }
  } catch (err) {
    message.error('选择目录失败')
    console.error(err)
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
    message.error('扫描失败')
    console.error(err)
  } finally {
    scanning.value = false
  }
}

async function handleSave(): Promise<void> {
  if (!form.value.name || !form.value.cwd || !form.value.command) {
    message.warning('请填写必填字段: 名称、工作目录、命令')
    return
  }

  saving.value = true
  try {
    if (isEdit.value && props.service) {
      await workspaceStore.updateService({ id: props.service.id, ...form.value })
      message.success('服务已更新')
    } else {
      await workspaceStore.createService(form.value as Record<string, unknown>)
      message.success('服务已创建')
    }
    emit('saved')
    emit('update:show', false)
  } catch (err) {
    const error = err as { message?: string }
    message.error(`保存失败: ${error?.message ?? '未知错误'}`)
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
      <NForm label-placement="top">
        <!-- Basic -->
        <NFormItem label="服务名称" required>
          <NInput v-model:value="form.name" placeholder="例如：前端开发服务器" />
        </NFormItem>

        <NFormItem label="服务类型" required>
          <NSelect v-model:value="form.type" :options="serviceTypes" />
        </NFormItem>

        <NFormItem label="工作目录" required>
          <NSpace>
            <NInput
              v-model:value="form.cwd"
              placeholder="选择或输入项目目录"
              style="width: 340px;"
            />
            <NButton @click="selectDirectory" quaternary>
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

        <NFormItem label="启动命令" required>
          <NInput v-model:value="form.command" placeholder="例如：npm / pnpm / mvn" />
        </NFormItem>

        <NFormItem label="参数">
          <NDynamicTags v-model:value="form.args" :max="20" />
        </NFormItem>

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

        <!-- Advanced -->
        <NCollapse>
          <NCollapseItem title="高级设置" name="advanced">
            <NFormItem label="启动延迟 (ms)">
              <NInputNumber
                v-model:value="form.startupDelay"
                :min="0"
                :max="60000"
                :step="500"
                style="width: 200px;"
              />
            </NFormItem>

            <NFormItem label="自动打开浏览器">
              <NSwitch v-model:value="form.autoOpenBrowser" />
            </NFormItem>

            <NFormItem v-if="form.autoOpenBrowser" label="打开 URL">
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

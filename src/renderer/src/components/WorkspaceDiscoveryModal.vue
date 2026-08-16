<script setup lang="ts">
// PX Dev — WorkspaceDiscoveryModal（Phase 3）
//
// 「扫描工作区 → 确认候选 → 批量添加服务」的确认弹窗。
//
// 状态机：idle → scanning → review → applying → done | error
// - idle     刚打开，尚未扫描
// - scanning 扫描中（禁用交互）
// - review   已拿到候选列表，等待用户勾选
// - applying 正在批量创建 Service
// - error    扫描失败（可读原因展示在顶部 Alert）
//
// 序列化约束：所有跨 IPC 的入参都经 discoveryPayload / api 层 toPlain() 净化，
// 绝不把 ref/reactive 的 Proxy 直接送过 contextBridge。

import { computed, ref, watch } from 'vue'
import {
  NModal,
  NForm,
  NFormItem,
  NInput,
  NInputGroup,
  NInputNumber,
  NButton,
  NSpace,
  NSwitch,
  NCheckbox,
  NTag,
  NAlert,
  NEmpty,
  NSpin,
  NText,
  NScrollbar,
  NCollapse,
  NCollapseItem,
  NTooltip,
  useMessage,
} from 'naive-ui'
import { FolderOpenOutline, RefreshOutline, SearchOutline } from '@vicons/ionicons5'
import type {
  DetectedEndpoint,
  DetectedEndpointSource,
  DiscoveredProject,
  DiscoveryConfidence,
} from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { api } from '@renderer/api'
import { formatIpcError } from '@renderer/api/errors'
import { toServiceInputs } from './discoveryPayload'
import { logger } from '@renderer/utils/logger'

const props = defineProps<{
  show: boolean
  workspaceId: string
  /** 工作区已配置的根目录，打开时用作默认扫描路径 */
  rootPath?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  /** 批量添加成功后通知父组件刷新服务列表 */
  applied: [count: number]
}>()

const message = useMessage()
const workspaceStore = useWorkspaceStore()

/** 弹窗状态机 */
type Phase = 'idle' | 'scanning' | 'review' | 'applying' | 'error'

const phase = ref<Phase>('idle')
const errorText = ref('')

const rootPathInput = ref('')
const maxDepth = ref<number>(3)
const includeLibrary = ref(false)

const projects = ref<DiscoveredProject[]>([])
const warnings = ref<{ message: string; severity?: string }[]>([])
const selectedIds = ref<string[]>([])

// 目录选择对话框是否正在打开（防止连点刷出重复错误提示，与 WorkspaceCreateModal 一致）
const selectingDir = ref(false)
const SELECT_FAIL_COOLDOWN_MS = 800

const scanning = computed(() => phase.value === 'scanning')
const applying = computed(() => phase.value === 'applying')
const selectedCount = computed(() => selectedIds.value.length)
const canApply = computed(() => phase.value === 'review' && selectedCount.value > 0)

// 全选状态（用于 v-model）
const allSelected = ref(false)

// ============ Select All ============
const isAllSelected = computed(() => {
  if (projects.value.length === 0) return false
  return projects.value.every((p) => selectedIds.value.includes(p.id))
})

const isIndeterminate = computed(() => {
  if (projects.value.length === 0) return false
  const selected = projects.value.filter((p) => selectedIds.value.includes(p.id)).length
  return selected > 0 && selected < projects.value.length
})

function toggleSelectAll(checked: boolean): void {
  if (checked) {
    selectedIds.value = projects.value.map((p) => p.id)
  } else {
    selectedIds.value = []
  }
  allSelected.value = checked
}

// 只选前端
function selectOnlyFrontend(): void {
  selectedIds.value = projects.value
    .filter((p) => p.suggestedServiceType === 'frontend' || p.projectType === 'frontend')
    .map((p) => p.id)
  updateAllSelectedState()
}

// 只选后端
function selectOnlyBackend(): void {
  selectedIds.value = projects.value
    .filter((p) => {
      const t = p.suggestedServiceType ?? p.projectType
      return t !== 'frontend'
    })
    .map((p) => p.id)
  updateAllSelectedState()
}

function updateAllSelectedState(): void {
  allSelected.value = projects.value.length > 0 && selectedIds.value.length === projects.value.length
}

// 选中状态判断
const isOnlyFrontendSelected = computed(() => {
  if (projects.value.length === 0) return false
  const frontendIds = projects.value
    .filter((p) => p.suggestedServiceType === 'frontend')
    .map((p) => p.id)
  if (frontendIds.length === 0) return false
  return frontendIds.every((id) => selectedIds.value.includes(id)) && selectedIds.value.length === frontendIds.length
})

const isOnlyBackendSelected = computed(() => {
  if (projects.value.length === 0) return false
  const backendIds = projects.value
    .filter((p) => {
      const t = p.suggestedServiceType ?? p.projectType
      return t !== 'frontend'
    })
    .map((p) => p.id)
  if (backendIds.length === 0) return false
  return backendIds.every((id) => selectedIds.value.includes(id)) && selectedIds.value.length === backendIds.length
})

const confidenceMeta: Record<DiscoveryConfidence, { label: string; type: 'success' | 'warning' | 'default' }> = {
  high: { label: '高可信', type: 'success' },
  medium: { label: '中可信', type: 'warning' },
  low: { label: '低可信', type: 'default' },
}

/** 打开时重置全部状态，避免残留上一次的候选列表 */
watch(
  () => props.show,
  (show) => {
    if (!show) return
    phase.value = 'idle'
    errorText.value = ''
    rootPathInput.value = props.rootPath ?? ''
    maxDepth.value = 3
    includeLibrary.value = false
    projects.value = []
    warnings.value = []
    selectedIds.value = []
    allSelected.value = false
  },
)

/** 端口来源的中文标签（Phase 4：静态四路；Phase 5 会再补 runtime-log） */
const endpointSourceLabel: Record<DetectedEndpointSource, string> = {
  command: '命令参数',
  config: '配置文件',
  env: '环境变量',
  'framework-default': '框架默认',
  'runtime-log': '运行实测',
  user: '手动设置',
}

/**
 * 端口展示元信息：来源徽标 + 可信度 tooltip。
 * 低可信（框架默认值）一律标灰并表述为「推测端口」，避免用户误以为是实测值。
 */
function portMeta(project: DiscoveredProject): {
  low: boolean
  sourceLabel: string
  tip: string
} {
  const endpoint: DetectedEndpoint | undefined = (project.endpoints ?? []).find(
    (e) => e.port === project.detectedPort,
  )
  const source = endpoint?.source ?? 'framework-default'
  const confidence = endpoint?.confidence ?? 'low'
  const low = confidence === 'low'
  const prefix = low ? '推测端口' : '检测到端口'
  return {
    low,
    sourceLabel: endpointSourceLabel[source],
    tip: `${prefix} ${project.detectedPort}（来源：${endpointSourceLabel[source]}，可信度：${confidenceMeta[confidence].label}）${
      low ? '；框架默认值可能不准，可在服务详情中修改' : ''
    }`,
  }
}

/** 命令预览：`npm run dev` 这样的一行摘要 */
function commandSummary(project: DiscoveredProject): string {
  const parts = [project.command ?? '', ...(project.args ?? [])].filter(Boolean)
  return parts.join(' ')
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id)
}

function toggleSelect(id: string, checked: boolean): void {
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
  } else {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  }
}

/** 打开原生目录选择对话框填入扫描根目录 */
async function handleSelectRootPath(): Promise<void> {
  if (selectingDir.value) return

  selectingDir.value = true
  try {
    const path = await api.system.selectDirectory()
    if (!path) return
    rootPathInput.value = path
  } catch (err) {
    logger.error('WorkspaceDiscoveryModal', 'Failed to select directory', err)
    message.error(formatIpcError(err, '选择目录失败'))
    await new Promise((resolve) => setTimeout(resolve, SELECT_FAIL_COOLDOWN_MS))
  } finally {
    selectingDir.value = false
  }
}

/** 执行（或重新执行）扫描 */
async function handleScan(): Promise<void> {
  const root = rootPathInput.value.trim()
  if (!root) {
    message.warning('请先选择要扫描的根目录')
    return
  }
  if (scanning.value) return

  phase.value = 'scanning'
  errorText.value = ''
  try {
    const result = await workspaceStore.discover(
      root,
      {
        maxDepth: maxDepth.value ?? 3,
        includeLibrary: includeLibrary.value,
      },
      props.workspaceId,
    )

    projects.value = result.projects
    warnings.value = result.warnings.map((w) => ({ message: w.message, severity: w.severity }))
    // 默认勾选由扫描器给出：!isLibrary && confidence !== 'low'
    selectedIds.value = result.projects.filter((p) => p.suggestedSelected).map((p) => p.id)
    // 同步全选状态
    allSelected.value = projects.value.length > 0 && selectedIds.value.length === projects.value.length
    phase.value = 'review'

    if (result.projects.length === 0) {
      message.info('未在该目录下发现可识别的项目')
    }
  } catch (err) {
    logger.error('WorkspaceDiscoveryModal', 'Failed to discover projects', err)
    errorText.value = formatIpcError(err, '扫描失败')
    phase.value = 'error'
  }
}

/** 批量创建所选服务 */
async function handleApply(): Promise<void> {
  if (!canApply.value) return

  const chosen = projects.value.filter((p) => selectedIds.value.includes(p.id))
  if (chosen.length === 0) {
    message.warning('请至少勾选一个服务')
    return
  }

  phase.value = 'applying'
  try {
    const inputs = toServiceInputs(chosen, props.workspaceId)
    const created = await workspaceStore.applyDiscovery(props.workspaceId, inputs)
    message.success(`已添加 ${created.length} 个服务`)
    emit('applied', created.length)
    emit('update:show', false)
  } catch (err) {
    logger.error('WorkspaceDiscoveryModal', 'Failed to apply discovery', err)
    message.error(formatIpcError(err, '批量添加服务失败'))
    // 失败后回到 review，让用户可以调整勾选后重试
    phase.value = 'review'
  }
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v) => emit('update:show', v)"
    preset="card"
    title="扫描工作区"
    style="width: 720px;"
    :bordered="false"
    :mask-closable="!scanning && !applying"
  >
    <NForm label-placement="top">
      <NFormItem label="扫描根目录" required>
        <NInputGroup>
          <NInput
            v-model:value="rootPathInput"
            placeholder="选择或输入要扫描的目录"
            :disabled="scanning || applying"
          />
          <NButton
            :loading="selectingDir"
            :disabled="scanning || applying"
            @click="handleSelectRootPath"
          >
            <template #icon><FolderOpenOutline /></template>
            浏览
          </NButton>
          <NButton type="primary" :loading="scanning" @click="handleScan">
            <template #icon><SearchOutline /></template>
            开始扫描
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NSpace align="center" :size="24">
        <NSpace align="center" :size="8">
          <NText depth="3">最大扫描深度</NText>
          <NInputNumber
            v-model:value="maxDepth"
            :min="1"
            :max="8"
            :disabled="scanning || applying"
            style="width: 120px;"
          />
        </NSpace>
        <NSpace align="center" :size="8">
          <NText depth="3">包含 library 模块</NText>
          <NSwitch v-model:value="includeLibrary" :disabled="scanning || applying" />
        </NSpace>
      </NSpace>
    </NForm>

    <!-- 扫描失败 -->
    <NAlert v-if="phase === 'error'" type="error" class="block" :show-icon="true">
      {{ errorText }}
    </NAlert>

    <!-- 告警 -->
    <NAlert
      v-else-if="warnings.length > 0"
      type="warning"
      class="block"
      :title="`扫描过程中有 ${warnings.length} 条提示`"
    >
      <div v-for="(w, i) in warnings.slice(0, 5)" :key="i">{{ w.message }}</div>
    </NAlert>

    <!-- 候选列表 -->
    <NSpin :show="scanning">
      <div class="result-area">
        <NEmpty
          v-if="phase === 'idle'"
          description="选择根目录后点击「开始扫描」"
          class="placeholder"
        />
        <NEmpty
          v-else-if="phase === 'review' && projects.length === 0"
          description="未发现可识别的项目"
          class="placeholder"
        />
        <div v-else-if="projects.length > 0" class="projects-header">
          <div class="selection-group">
            <label
              class="selection-btn"
              :class="{ active: isAllSelected }"
              @click="toggleSelectAll(!isAllSelected)"
            >
              全选
            </label>
            <label
              class="selection-btn"
              :class="{ active: isOnlyFrontendSelected }"
              @click="selectOnlyFrontend"
            >
              只选前端
            </label>
            <label
              class="selection-btn"
              :class="{ active: isOnlyBackendSelected }"
              @click="selectOnlyBackend"
            >
              只选后端
            </label>
          </div>
          <NText depth="3" style="margin-left: auto;">
            共 {{ projects.length }} 个候选，已选 {{ selectedCount }} 个
          </NText>
        </div>
        <NScrollbar v-if="projects.length > 0" style="max-height: 340px;">
          <div v-for="project in projects" :key="project.id" class="project-row">
            <NCheckbox
              :checked="isSelected(project.id)"
              :disabled="applying"
              @update:checked="(v) => toggleSelect(project.id, v)"
            />
            <div class="project-main">
              <div class="project-title">
                <span class="project-name">{{ project.name }}</span>
                <NTag size="small" :bordered="false">
                  {{ project.suggestedServiceType ?? project.projectType }}
                </NTag>
                <NTag v-if="project.framework" size="small" type="info" :bordered="false">
                  {{ project.framework }}
                </NTag>
                <NTag
                  size="small"
                  :bordered="false"
                  :type="confidenceMeta[project.confidence].type"
                >
                  {{ confidenceMeta[project.confidence].label }}
                </NTag>
                <NTag v-if="project.isLibrary" size="small" :bordered="false">library</NTag>
              </div>
              <div class="project-meta">
                <NText depth="3">{{ project.relativePath }}</NText>
                <NText v-if="commandSummary(project)" depth="3" class="cmd">
                  {{ commandSummary(project) }}
                </NText>
                <!-- 端口列：来源徽标 + 可信度 tooltip；低可信（框架默认值）标灰为「推测端口」 -->
                <NTooltip v-if="project.detectedPort" trigger="hover">
                  <template #trigger>
                    <NText :depth="portMeta(project).low ? 3 : 2" class="port">
                      :{{ project.detectedPort }}
                      <NTag
                        size="tiny"
                        :bordered="false"
                        :type="portMeta(project).low ? 'default' : 'info'"
                      >
                        {{ portMeta(project).sourceLabel }}
                      </NTag>
                    </NText>
                  </template>
                  {{ portMeta(project).tip }}
                </NTooltip>
              </div>
              <NCollapse v-if="project.evidence.length > 0" class="evidence">
                <NCollapseItem title="识别依据" :name="project.id">
                  <div v-for="(ev, i) in project.evidence" :key="i" class="evidence-item">
                    <NText depth="3">{{ ev.detail }}（{{ ev.source }}）</NText>
                  </div>
                </NCollapseItem>
              </NCollapse>
            </div>
          </div>
        </NScrollbar>
      </div>
    </NSpin>

    <template #footer>
      <NSpace justify="space-between" align="center">
        <div></div>
        <NSpace>
          <NButton :disabled="scanning || applying" @click="emit('update:show', false)">
            取消
          </NButton>
          <NButton :loading="scanning" :disabled="applying" @click="handleScan">
            <template #icon><RefreshOutline /></template>
            重新扫描
          </NButton>
          <NButton type="primary" :disabled="!canApply" :loading="applying" @click="handleApply">
            添加所选服务
          </NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.block {
  margin-bottom: var(--sp-3, 12px);
}

.result-area {
  min-height: 160px;
}

.projects-header {
  display: flex;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid var(--n-border-color, rgba(255, 255, 255, 0.09));
}

.selection-group {
  display: flex;
  gap: 4px;
  background: var(--n-action-color, rgba(255, 255, 255, 0.06));
  padding: 3px;
  border-radius: 20px;
}

.selection-btn {
  padding: 4px 14px;
  font-size: 13px;
  color: #555;
  cursor: pointer;
  border-radius: 16px;
  transition: all 0.2s ease;
  user-select: none;
}

.selection-btn:hover {
  color: #111;
}

.selection-btn.active {
  background: var(--n-primary-color, #18a058) !important;
  color: #fff !important;
}

.placeholder {
  padding: 32px 0;
}

.project-row {
  display: flex;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--n-border-color, rgba(255, 255, 255, 0.09));
}

.project-main {
  flex: 1;
  min-width: 0;
}

.project-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.project-name {
  font-weight: 600;
}

.project-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
  font-size: 12px;
}

.cmd {
  font-family: var(--font-mono, monospace);
}

.port {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono, monospace);
}

.evidence-item {
  font-size: 12px;
  line-height: 1.7;
}
</style>

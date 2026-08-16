// PX Dev — IPC Channel Names + Response Types
// All channel name string constants (re-exported from constants for type safety)

import type { ProcessRuntime, LogEntry } from './index'
import type { RuntimeEndpointSnapshot } from './discovery'

// ============ IPC Channel Names (type-level) ============
export const IPC_CHANNELS = {
  // Workspace
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_DELETE: 'workspace:delete',
  /** 扫描工作区根目录，返回 WorkspaceDiscoveryResult */
  WORKSPACE_DISCOVER: 'workspace:discover',
  /** 把勾选的发现结果批量创建为 Service（单次落盘） */
  WORKSPACE_APPLY_DISCOVERY: 'workspace:applyDiscovery',
  /** 拉取运行时端点快照（纯内存；窗口刷新后事件丢失的兜底） */
  WORKSPACE_RUNTIME_ENDPOINTS: 'workspace:runtimeEndpoints',

  // Service
  SERVICE_LIST: 'service:list',
  SERVICE_CREATE: 'service:create',
  SERVICE_UPDATE: 'service:update',
  SERVICE_DELETE: 'service:delete',
  SERVICE_START: 'service:start',
  SERVICE_STOP: 'service:stop',
  SERVICE_RESTART: 'service:restart',
  SERVICE_FORCE_KILL: 'service:forceKill',
  SERVICE_RUNTIME: 'service:runtime',
  SERVICE_START_WORKSPACE: 'service:startWorkspace',
  SERVICE_STOP_WORKSPACE: 'service:stopWorkspace',
  SERVICE_STOP_ALL: 'service:stopAll',

  // Log
  LOG_SUBSCRIBE: 'log:subscribe',
  LOG_UNSUBSCRIBE: 'log:unsubscribe',
  LOG_CLEAR: 'log:clear',
  LOG_HISTORY: 'log:history',
  LOG_EXPORT: 'log:export',

  // Log events (M→R)
  LOG_BATCH_EVENT: 'log:batch',

  // Environment
  ENVIRONMENT_DETECT: 'environment:detect',
  ENVIRONMENT_DETECT_SINGLE: 'environment:detectSingle',

  // Port
  PORT_CHECK: 'port:check',
  PORT_OWNER: 'port:owner',
  PORT_KILL: 'port:kill',
  PORT_WAIT_LISTENING: 'port:waitListening',

  // System
  SYSTEM_OPEN_PATH: 'system:openPath',
  SYSTEM_OPEN_EXTERNAL: 'system:openExternal',
  SYSTEM_SELECT_DIRECTORY: 'system:selectDirectory',
  SYSTEM_SCAN_DIRECTORY: 'system:scanDirectory',
  SYSTEM_SHOW_ITEM: 'system:showItemInFolder',
  /** 单目录轻量检测，返回 DiscoveredProject | null */
  SYSTEM_DETECT_PROJECT: 'system:detectProject',

  // App
  APP_GET_SETTINGS: 'app:getSettings',
  APP_UPDATE_SETTINGS: 'app:updateSettings',
  APP_GET_VERSION: 'app:getVersion',
  APP_QUIT: 'app:quit',
  APP_MINIMIZE: 'app:minimize',

  // Data path
  APP_GET_DATA_PATH: 'app:getDataPath',
  APP_SELECT_DATA_PATH: 'app:selectDataPath',

  // Runtime event (M→R)
  SERVICE_RUNTIME_CHANGED_EVENT: 'service:runtime:changed',
  /** 运行时端点变更事件（M→R，Phase 5） */
  RUNTIME_ENDPOINTS_EVENT: 'runtime:endpoints',
} as const

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// ============ Event Payload Types ============
export interface RuntimeChangedPayload {
  serviceId: string
  runtime: ProcessRuntime
}

export interface LogBatchPayload {
  serviceId: string
  entries: LogEntry[]
}

/**
 * `runtime:endpoints` 事件 payload（Phase 5）。
 * runtime === null 表示该服务已停止 / 正在重启，渲染层应清空展示。
 */
export interface RuntimeEndpointsEventPayload {
  serviceId: string
  runtime: RuntimeEndpointSnapshot | null
}

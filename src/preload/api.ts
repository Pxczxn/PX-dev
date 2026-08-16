// PX Dev — Preload API (contextBridge whitelist)
// Exposes a typed API to the renderer via window.pxDev

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import type {
  Workspace,
  Service,
  LogEntry,
  ProcessRuntime,
  EnvironmentInfo,
  PortOwner,
  ScanResult,
  Settings,
  DiscoveredProject,
  WorkspaceDiscoveryResult,
  RuntimeEndpointSnapshot,
} from '@shared/types'

// ============ API Definition ============
export interface PxDevAPI {
  // Workspace
  workspace: {
    list: () => Promise<Workspace[]>
    create: (input: Record<string, unknown>) => Promise<Workspace>
    update: (input: Record<string, unknown>) => Promise<Workspace>
    delete: (id: string) => Promise<{ success: boolean }>
    /** 扫描根目录，返回发现结果（Phase 3） */
    discover: (input: Record<string, unknown>) => Promise<WorkspaceDiscoveryResult>
    /** 把勾选的发现结果批量创建为 Service（Phase 3） */
    applyDiscovery: (input: Record<string, unknown>) => Promise<Service[]>
    /** Phase 6：拉取运行时端点快照（纯内存，窗口刷新后兜底） */
    getRuntimeEndpoints: (input?: Record<string, unknown>) => Promise<RuntimeEndpointSnapshot[]>
  }
  // Service CRUD
  service: {
    list: (workspaceId?: string) => Promise<Service[]>
    create: (input: Record<string, unknown>) => Promise<Service>
    update: (input: Record<string, unknown>) => Promise<Service>
    delete: (id: string) => Promise<{ success: boolean }>
  }
  // Service process operations
  process: {
    start: (serviceId: string) => Promise<ProcessRuntime>
    stop: (serviceId: string) => Promise<ProcessRuntime>
    restart: (serviceId: string) => Promise<ProcessRuntime>
    forceKill: (serviceId: string) => Promise<{ success: boolean }>
    getRuntime: (serviceId?: string) => Promise<ProcessRuntime | ProcessRuntime[]>
    startWorkspace: (workspaceId: string) => Promise<unknown[]>
    stopWorkspace: (workspaceId: string) => Promise<{ success: boolean }>
    stopAll: () => Promise<{ success: boolean }>
  }
  // Log
  log: {
    subscribe: (serviceId: string) => Promise<{ success: boolean }>
    unsubscribe: (serviceId: string) => Promise<{ success: boolean }>
    clear: (serviceId: string) => Promise<{ success: boolean }>
    history: (serviceId: string, limit?: number) => Promise<LogEntry[]>
    export: (serviceId: string, savePath?: string) => Promise<{ success: boolean; path?: string }>
  }
  // Environment
  environment: {
    detect: () => Promise<EnvironmentInfo[]>
    detectSingle: (name: string) => Promise<EnvironmentInfo>
  }
  // Port
  port: {
    check: (port: number) => Promise<{ port: number; available: boolean }>
    owner: (port: number) => Promise<PortOwner | null>
    kill: (pid: number) => Promise<{ success: boolean }>
    waitListening: (port: number, timeoutMs?: number) => Promise<{ port: number; listening: boolean }>
  }
  // System
  system: {
    openPath: (path: string) => Promise<{ success: boolean }>
    openExternal: (url: string) => Promise<{ success: boolean }>
    selectDirectory: () => Promise<string | null>
    scanDirectory: (path: string) => Promise<ScanResult>
    showItemInFolder: (path: string) => Promise<{ success: boolean }>
    /** 单目录轻量检测；未命中项目标记文件时返回 null（Phase 3） */
    detectProject: (path: string) => Promise<DiscoveredProject | null>
  }
  // App
  app: {
    getSettings: () => Promise<Settings>
    updateSettings: (input: Record<string, unknown>) => Promise<Settings>
    getVersion: () => Promise<string>
    quit: () => Promise<{ success: boolean }>
    minimize: () => Promise<{ success: boolean }>
    /** 获取当前数据目录路径 */
    getDataPath: () => Promise<string>
    /** 打开目录选择器，更改数据目录（会触发重启） */
    selectDataPath: () => Promise<{ success: boolean; newPath?: string; reason?: string }>
  }
  // Event listeners
  events: {
    onLogBatch: (callback: (payload: { serviceId: string; entries: LogEntry[] }) => void) => () => void
    onRuntimeChanged: (callback: (payload: { serviceId: string; runtime: ProcessRuntime }) => void) => () => void
    /** Phase 6：运行时端点变更事件（M→R，节流 500ms） */
    onRuntimeEndpoints: (callback: (payload: { serviceId: string; runtime: RuntimeEndpointSnapshot | null }) => void) => () => void
  }
}

// ============ Build API ============
export function createPxDevAPI(): PxDevAPI {
  return {
    workspace: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LIST),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CREATE, input),
      update: (input) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_UPDATE, input),
      delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_DELETE, { id }),
      discover: (input) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_DISCOVER, input),
      applyDiscovery: (input) =>
        ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY, input),
      getRuntimeEndpoints: (input) =>
        ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_RUNTIME_ENDPOINTS, input ?? {}),
    },
    service: {
      list: (workspaceId) =>
        ipcRenderer.invoke(IPC_CHANNELS.SERVICE_LIST, workspaceId ? { workspaceId } : {}),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_CREATE, input),
      update: (input) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_UPDATE, input),
      delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_DELETE, { id }),
    },
    process: {
      start: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_START, { serviceId }),
      stop: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_STOP, { serviceId }),
      restart: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_RESTART, { serviceId }),
      forceKill: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_FORCE_KILL, { serviceId }),
      getRuntime: (serviceId) =>
        ipcRenderer.invoke(IPC_CHANNELS.SERVICE_RUNTIME, serviceId ? { serviceId } : {}),
      startWorkspace: (workspaceId) =>
        ipcRenderer.invoke(IPC_CHANNELS.SERVICE_START_WORKSPACE, { workspaceId }),
      stopWorkspace: (workspaceId) =>
        ipcRenderer.invoke(IPC_CHANNELS.SERVICE_STOP_WORKSPACE, { workspaceId }),
      stopAll: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_STOP_ALL),
    },
    log: {
      subscribe: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.LOG_SUBSCRIBE, { serviceId }),
      unsubscribe: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.LOG_UNSUBSCRIBE, { serviceId }),
      clear: (serviceId) => ipcRenderer.invoke(IPC_CHANNELS.LOG_CLEAR, { serviceId }),
      history: (serviceId, limit) =>
        ipcRenderer.invoke(IPC_CHANNELS.LOG_HISTORY, { serviceId, limit }),
      export: (serviceId, savePath) =>
        ipcRenderer.invoke(IPC_CHANNELS.LOG_EXPORT, { serviceId, savePath }),
    },
    environment: {
      detect: () => ipcRenderer.invoke(IPC_CHANNELS.ENVIRONMENT_DETECT),
      detectSingle: (name) =>
        ipcRenderer.invoke(IPC_CHANNELS.ENVIRONMENT_DETECT_SINGLE, { name }),
    },
    port: {
      check: (port) => ipcRenderer.invoke(IPC_CHANNELS.PORT_CHECK, { port }),
      owner: (port) => ipcRenderer.invoke(IPC_CHANNELS.PORT_OWNER, { port }),
      kill: (pid) => ipcRenderer.invoke(IPC_CHANNELS.PORT_KILL, { pid }),
      waitListening: (port, timeoutMs) =>
        ipcRenderer.invoke(IPC_CHANNELS.PORT_WAIT_LISTENING, { port, timeoutMs }),
    },
    system: {
      openPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_PATH, { path }),
      openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, { url }),
      selectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_DIRECTORY),
      scanDirectory: (path) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SCAN_DIRECTORY, { path }),
      showItemInFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, { path }),
      detectProject: (path) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_DETECT_PROJECT, { path }),
    },
    app: {
      getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_SETTINGS),
      updateSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.APP_UPDATE_SETTINGS, input),
      getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
      quit: () => ipcRenderer.invoke(IPC_CHANNELS.APP_QUIT),
      minimize: () => ipcRenderer.invoke(IPC_CHANNELS.APP_MINIMIZE),
      getDataPath: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_DATA_PATH),
      selectDataPath: () => ipcRenderer.invoke(IPC_CHANNELS.APP_SELECT_DATA_PATH),
    },
    events: {
      onLogBatch: (callback) => {
        const handler = (_event: unknown, payload: { serviceId: string; entries: LogEntry[] }) =>
          callback(payload)
        ipcRenderer.on(IPC_CHANNELS.LOG_BATCH_EVENT, handler)
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.LOG_BATCH_EVENT, handler)
        }
      },
      onRuntimeChanged: (callback) => {
        const handler = (
          _event: unknown,
          payload: { serviceId: string; runtime: ProcessRuntime },
        ) => callback(payload)
        ipcRenderer.on(IPC_CHANNELS.SERVICE_RUNTIME_CHANGED_EVENT, handler)
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.SERVICE_RUNTIME_CHANGED_EVENT, handler)
        }
      },
      onRuntimeEndpoints: (callback) => {
        const handler = (
          _event: unknown,
          payload: { serviceId: string; runtime: RuntimeEndpointSnapshot | null },
        ) => callback(payload)
        ipcRenderer.on(IPC_CHANNELS.RUNTIME_ENDPOINTS_EVENT, handler)
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.RUNTIME_ENDPOINTS_EVENT, handler)
        }
      },
    },
  }
}

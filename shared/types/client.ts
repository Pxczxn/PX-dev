// PX Dev Client API Interface
// Renderer 通用 API 接口，不依赖 Electron Preload
// Phase 1: 定义完整接口，Tauri Adapter 实现时未迁移方法抛出 NotImplementedError

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
} from './index'

export interface PxDevClient {
  workspace: WorkspaceAPI
  service: ServiceAPI
  process: ProcessAPI
  log: LogAPI
  environment: EnvironmentAPI
  port: PortAPI
  system: SystemAPI
  app: AppAPI
  events: EventsAPI
}

export interface WorkspaceAPI {
  list: () => Promise<Workspace[]>
  create: (input: Record<string, unknown>) => Promise<Workspace>
  update: (input: Record<string, unknown>) => Promise<Workspace>
  delete: (id: string) => Promise<{ success: boolean }>
  discover: (input: Record<string, unknown>) => Promise<WorkspaceDiscoveryResult>
  applyDiscovery: (input: Record<string, unknown>) => Promise<Service[]>
  getRuntimeEndpoints: (input?: Record<string, unknown>) => Promise<RuntimeEndpointSnapshot[]>
}

export interface ServiceAPI {
  list: (workspaceId?: string) => Promise<Service[]>
  create: (input: Record<string, unknown>) => Promise<Service>
  update: (input: Record<string, unknown>) => Promise<Service>
  delete: (id: string) => Promise<{ success: boolean }>
}

export interface ProcessAPI {
  start: (serviceId: string) => Promise<ProcessRuntime>
  stop: (serviceId: string) => Promise<ProcessRuntime>
  restart: (serviceId: string) => Promise<ProcessRuntime>
  forceKill: (serviceId: string) => Promise<{ success: boolean }>
  getRuntime: (serviceId?: string) => Promise<ProcessRuntime | ProcessRuntime[]>
  startWorkspace: (workspaceId: string) => Promise<unknown[]>
  stopWorkspace: (workspaceId: string) => Promise<{ success: boolean }>
  stopAll: () => Promise<{ success: boolean }>
}

export interface LogAPI {
  subscribe: (serviceId: string) => Promise<{ success: boolean }>
  unsubscribe: (serviceId: string) => Promise<{ success: boolean }>
  clear: (serviceId: string) => Promise<{ success: boolean }>
  history: (serviceId: string, limit?: number) => Promise<LogEntry[]>
  export: (serviceId: string, savePath?: string) => Promise<{ success: boolean; path?: string }>
}

export interface EnvironmentAPI {
  detect: () => Promise<EnvironmentInfo[]>
  detectSingle: (name: string) => Promise<EnvironmentInfo>
}

export interface PortAPI {
  check: (port: number) => Promise<{ port: number; available: boolean }>
  owner: (port: number) => Promise<PortOwner | null>
  kill: (pid: number) => Promise<{ success: boolean }>
  waitListening: (port: number, timeoutMs?: number) => Promise<{ port: number; listening: boolean }>
}

export interface SystemAPI {
  ping: () => Promise<string>  // Phase 1: 新增必选方法
  openPath: (path: string) => Promise<{ success: boolean }>
  openExternal: (url: string) => Promise<{ success: boolean }>
  selectDirectory: () => Promise<string | null>
  scanDirectory: (path: string) => Promise<ScanResult>
  showItemInFolder: (path: string) => Promise<{ success: boolean }>
  detectProject: (path: string) => Promise<DiscoveredProject | null>
}

export interface AppAPI {
  getSettings: () => Promise<Settings>
  updateSettings: (input: Record<string, unknown>) => Promise<Settings>
  getVersion: () => Promise<string>
  quit: () => Promise<{ success: boolean }>
  minimize: () => Promise<{ success: boolean }>
  getDataPath: () => Promise<string>
  selectDataPath: () => Promise<{ success: boolean; newPath?: string; reason?: string }>
}

export interface EventsAPI {
  onLogBatch: (callback: (payload: { serviceId: string; entries: LogEntry[] }) => void) => () => void
  onRuntimeChanged: (callback: (payload: { serviceId: string; runtime: ProcessRuntime }) => void) => () => void
  onRuntimeEndpoints: (callback: (payload: { serviceId: string; runtime: RuntimeEndpointSnapshot | null }) => void) => () => void
}

// PX Dev — Shared Type Definitions
// All TS interfaces shared across Main / Preload / Renderer

// ============ Workspace ============
export interface Workspace {
  /** crypto.randomUUID() */
  id: string
  /** 非空 */
  name: string
  description?: string
  /** 工作区根目录（可选） */
  rootPath?: string
  /** hex 颜色，用于卡片标识 */
  color?: string
  /** 图标名（@vicons） */
  icon?: string
  /** 是否收藏 */
  favorite: boolean
  /** 启动模式 */
  startMode: 'parallel' | 'sequential' | 'dependency'
  /** ISO 8601 UTC */
  createdAt: string
  /** ISO 8601 UTC */
  updatedAt: string
}

// ============ Service ============
export interface Service {
  /** crypto.randomUUID() */
  id: string
  /** 关联 Workspace.id */
  workspaceId: string
  /** 非空 */
  name: string
  /** 服务类型 */
  type: 'frontend' | 'node' | 'java' | 'generic'
  /** 工作目录（绝对路径，非空） */
  cwd: string
  /** 可执行命令（如 'npm' / 'pnpm' / 'mvnw'） */
  command: string
  /** 参数数组（如 ['run', 'dev']） */
  args?: string[]
  /** 包管理器 */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'custom'
  /** 端口号 1-65535 */
  port?: number
  /** 环境变量 */
  env?: Record<string, string>
  /** .env 文件路径 */
  envFile?: string
  /** 是否参与一键启动 */
  enabled: boolean
  /** 依赖的其他 Service.id */
  dependencies: string[]
  /** 启动延迟（ms） */
  startupDelay?: number
  /** 就绪后自动打开浏览器 */
  autoOpenBrowser?: boolean
  /** 打开的 URL */
  openUrl?: string
  /** 健康检查配置 */
  healthCheck?: HealthCheckConfig
  /** 是否用 shell:true（默认 false） */
  shellMode?: boolean
  /** ISO 8601 UTC */
  createdAt: string
  /** ISO 8601 UTC */
  updatedAt: string
}

// ============ HealthCheckConfig ============
export interface HealthCheckConfig {
  /** 检查类型 */
  type: 'none' | 'port' | 'http'
  /** port 模式: 端口号; http 模式: URL */
  target?: string
  /** 单次检查超时，默认 5000 */
  timeoutMs?: number
  /** 检查间隔，默认 2000 */
  intervalMs?: number
  /** 重试次数，默认 10 */
  retries?: number
}

// ============ ProcessRuntime（仅运行期） ============
export interface ProcessRuntime {
  serviceId: string
  pid?: number
  status: ProcessStatus
  /** 健康检查通过 = true */
  ready: boolean
  /** Date.now() 时间戳 */
  startedAt?: number
  stoppedAt?: number
  exitCode?: number | null
  /** 错误信息 */
  error?: string
}

// ============ Process Status ============
export type ProcessStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'failed'
  | 'unknown'

// ============ LogEntry ============
export interface LogEntry {
  serviceId: string
  /** Date.now() 毫秒时间戳 */
  timestamp: number
  stream: 'stdout' | 'stderr'
  /** 单行或多行文本 */
  text: string
}

// ============ Settings ============
export interface Settings {
  theme: 'light' | 'dark' | 'system'
  closeBehavior: 'tray' | 'quit' | 'ask'
  /** 默认 5000 */
  maxLogLines: number
  /** 启动后最小化到托盘 */
  startMinimized: boolean
  /** 启动后恢复上次运行工作区 */
  autoRestoreLastSession: boolean
  /** 服务启动间隔（ms），默认 1000 */
  startupInterval: number
  /** 日志显示时间戳 */
  showTimestamp: boolean
  /** 'system' 或浏览器 exe 路径 */
  defaultBrowser: string
}

// ============ AppConfig ============
export interface AppConfig {
  /** schema 版本号，当前 = 1 */
  version: number
  settings: Settings
  workspaces: Workspace[]
  services: Service[]
}

// ============ EnvironmentInfo ============
export interface EnvironmentInfo {
  name: string
  available: boolean
  version: string
  path: string
  error?: string
}

// ============ PortOwner ============
export interface PortOwner {
  port: number
  pid: number
  name: string
}

// ============ ScanResult ============
export interface ScanResult {
  path: string
  type: 'node' | 'maven' | 'gradle' | 'unknown'
  packageManager?: string
  recommendedCommand: string
  recommendedArgs: string[]
  scripts?: Record<string, string>
  detectedPort?: number
}

// ============ ManagedProcess（ProcessManager 内部） ============
export interface ManagedProcess {
  child: import('child_process').ChildProcess
  runtime: ProcessRuntime
}

// ============ IPC 统一响应格式 ============
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

// ============ Environment names ============
export type EnvironmentName =
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'java'
  | 'mvn'
  | 'gradle'
  | 'git'

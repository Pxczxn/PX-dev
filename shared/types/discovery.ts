// PX Dev — Workspace Discovery 类型定义（Phase 1 基线）
//
// 设计约定：
// 1. 本文件**只含类型**，不含任何运行时值，保证 `shared/types` barrel 依旧是纯类型模块。
//    运行时默认值（maxDepth 等）统一放在 `shared/schemas/discovery.schema.ts` 的 DISCOVERY_DEFAULTS。
// 2. Phase 2–6 才填充的字段一律声明为可选（`?`），避免后续阶段产生破坏性改动。
// 3. 所有类型必须是可结构化克隆的纯数据（string / number / boolean / 数组 / 普通对象），
//    禁止出现 class instance、function、FS handle、ChildProcess。

// ============ 基础枚举 ============

/** 发现结果的置信度 */
export type DiscoveryConfidence = 'high' | 'medium' | 'low'

/**
 * 发现出的项目类型。
 * 与 Service.type（frontend/node/java/generic）的差异在于多了一个 'unknown'，
 * 表示「目录有项目标记文件，但现有扫描器无法判定种类」。
 */
export type DiscoveryProjectType = 'frontend' | 'node' | 'java' | 'generic' | 'unknown'

/** 端点种类（Phase 4/5 使用，Phase 1 不填充） */
export type DetectedEndpointType = 'local' | 'network' | 'health' | 'unknown'

/** 端点来源（Phase 4/5 使用，Phase 1 不填充） */
export type DetectedEndpointSource =
  | 'command'
  | 'config'
  | 'env'
  | 'framework-default'
  | 'runtime-log'
  | 'user'

/**
 * 发现流程的告警码。
 * 与 `ERROR_CODES` 中的 `DISCOVERY_*` 系列保持一一对应，便于上层直接转 IpcError。
 */
export type DiscoveryWarningCode =
  | 'DISCOVERY_ROOT_NOT_FOUND'
  | 'DISCOVERY_ROOT_NOT_DIRECTORY'
  | 'DISCOVERY_PERMISSION_DENIED'
  | 'DISCOVERY_READ_FAILED'
  | 'DISCOVERY_DEPTH_LIMIT'
  | 'DISCOVERY_DIRECTORY_LIMIT'
  | 'DISCOVERY_TIMEOUT'
  | 'DISCOVERY_SYMLINK_SKIPPED'
  | 'DISCOVERY_PARSE_FAILED'
  | 'DISCOVERY_SCANNER_FAILED'

// ============ 证据 ============

/**
 * 判定依据。Phase 1 只产出「命中项目标记文件」这一类证据，
 * Phase 2 起会追加依赖 / 脚本 / 配置字段等更细粒度的证据。
 */
export interface DetectionEvidence {
  /** 证据种类，如 'marker-file' | 'dependency' | 'script' | 'config-field' */
  type: string
  /** 中文可读说明，可直接用于 UI tooltip */
  detail: string
  /** 证据来源，通常是相对 rootPath 的文件路径；无具体文件时为 'filesystem' */
  source: string
}

// ============ 端点（Phase 4/5） ============

/** 探测到的服务端点。Phase 1 全部声明为可选，不填充。 */
export interface DetectedEndpoint {
  type: DetectedEndpointType
  protocol?: 'http' | 'https'
  host?: string
  port?: number
  /** 完整 URL，能拼出时填充，便于 UI 直接打开 */
  url?: string
  source: DetectedEndpointSource
  confidence: DiscoveryConfidence
}

// ============ 运行时端点（Phase 5） ============

/**
 * Configured / Runtime 端口不一致的提示信息。
 *
 * ⚠️ 严格只读语义：Runtime 层**永不**静默覆盖 `Service.port`（Configured），
 * 本结构只用于 UI 提示，动作（更新配置 / 保持配置）留给 Phase 6。
 */
export interface RuntimePortConflict {
  /** Service.port（用户配置值） */
  configuredPort: number
  /** 日志实测到的端口 */
  runtimePort: number
  /** 中文提示，如「配置端口 3000，实际运行在 3001」 */
  message: string
}

/**
 * 某个服务的运行时端点快照。
 *
 * ⚠️ 纯内存数据：由 RuntimeEndpointRegistry 维护，进程停止即清空，
 * **绝不持久化到磁盘**，也绝不写回 ConfigManager。
 */
export interface RuntimeEndpointSnapshot {
  serviceId: string
  /** 已去重 + 按 endpointPriority 排序的端点集合（source 恒为 'runtime-log'） */
  endpoints: DetectedEndpoint[]
  /** 首选可打开 URL = 第一个 type==='local'，否则第一个 type==='network' */
  primaryUrl?: string
  /** 运行时实测端口（取首选端点的端口） */
  runtimePort?: number
  /** 与 Configured 端口的冲突提示；一致或信息不全时缺省 */
  conflict?: RuntimePortConflict
  /** 最近一次变更时间（epoch 毫秒） */
  updatedAt: number
}

/**
 * `runtime:endpoints` 事件 payload。
 * `runtime === null` 表示该服务已停止 / 重启，渲染层应清空对应展示。
 */
export interface RuntimeEndpointsPayload {
  serviceId: string
  runtime: RuntimeEndpointSnapshot | null
}

/** `workspace:runtimeEndpoints` 入参：不传 serviceId 则拉取全部快照 */
export interface RuntimeEndpointsQuery {
  serviceId?: string
}

// ============ 发现的项目 ============

/** 一个被发现的子项目（纯数据，可跨 IPC 传输） */
export interface DiscoveredProject {
  /** 稳定 ID = sha1(rootPath + '\0' + relativePath).slice(0,16)，重扫可比对 */
  id: string
  /** 绝对路径（已 path.resolve） */
  path: string
  /** 相对 rootPath 的路径；根目录自身为 '.' */
  relativePath: string
  /** 项目名（目录名；根目录取 root 目录名） */
  name: string
  projectType: DiscoveryProjectType

  // —— 以下为 Phase 2 / 4 的填充点，Phase 1 一律留空 ——
  /** 框架标识，如 'vite' | 'next' | 'spring-boot'（Phase 2） */
  framework?: string
  /** 包管理器，如 'npm' | 'pnpm' | 'yarn' | 'bun' | 'maven' | 'gradle'（Phase 2） */
  packageManager?: string
  /** 推荐的可执行文件名，不含参数（Phase 2） */
  command?: string
  /** 推荐参数数组，禁止把参数塞进 command（Phase 2） */
  args?: string[]
  /** endpoints 中最高优先级端口的快照（Phase 4） */
  detectedPort?: number
  /** 探测到的端点集合（Phase 4/5） */
  endpoints?: DetectedEndpoint[]
  /** monorepo library：默认不生成 Service（Phase 2） */
  isLibrary?: boolean
  /** monorepo 父项目 id（Phase 2） */
  parentProjectId?: string
  /**
   * 映射后的 Service.type（projectType 为 'unknown' 时回落 'generic'）。
   * 供 UI 创建 Service 时预填 type（Phase 2）。
   */
  suggestedServiceType?: 'frontend' | 'node' | 'java' | 'generic'
  /**
   * UI 默认是否勾选。
   * Phase 2 规则：`!isLibrary && confidence !== 'low'`；
   * Phase 6 会再叠加 `matchStatus !== 'unchanged'` 条件。
   */
  suggestedSelected?: boolean

  confidence: DiscoveryConfidence
  /** 判定依据列表，至少包含一条 */
  evidence: DetectionEvidence[]
  /** 该目录命中的项目标记文件名列表，如 ['package.json','pnpm-lock.yaml'] */
  configFiles: string[]
}

// ============ 告警 ============

/** 单条告警。发现流程「不中断」，所有非致命问题都降级为告警。 */
export interface DiscoveryWarning {
  code: DiscoveryWarningCode
  /** 中文可读描述 */
  message: string
  /** 相关路径（相对 rootPath；root 自身相关时为 '.'） */
  path?: string
  /** 严重级别，UI 可据此着色 */
  severity?: 'info' | 'warn' | 'error'
}

// ============ 统计 ============

/** 本次遍历的统计信息 */
export interface DiscoveryStats {
  /** 实际访问过的目录数（含 root） */
  scannedDirectories: number
  /** 实际到达的最大深度（root 自身为 0） */
  maxDepthReached: number
  /** 是否因 maxDirectories / timeout 提前结束 */
  truncated: boolean
  /** 遍历耗时（毫秒） */
  elapsedMs: number
  /** 被忽略清单 / 符号链接跳过的目录数 */
  skippedDirectories?: number
}

// ============ 请求 / 结果 ============

/** 发现选项。未传字段一律走 DISCOVERY_DEFAULTS。 */
export interface WorkspaceDiscoveryOptions {
  /** 最大深度，root 自身 depth=0；默认 3（maxDepth=3 最深访问 root/a/b/c） */
  maxDepth?: number
  /** 最多访问的目录数，默认 2000 */
  maxDirectories?: number
  /** 超时毫秒数，默认 15000 */
  timeout?: number
  /** 是否把 monorepo library 也列出来（Phase 2 生效），默认 false */
  includeLibrary?: boolean
  /** 追加忽略目录名（与默认清单合并） */
  extraIgnores?: string[]
}

/** system:discoverWorkspace 入参（IPC 接线在后续阶段） */
export interface WorkspaceDiscoveryRequest {
  rootPath: string
  /** 传入则执行 Diff（Phase 6），Phase 1 仅透传 */
  workspaceId?: string
  options?: WorkspaceDiscoveryOptions
}

/** 发现结果（纯数据，可 structuredClone） */
export interface WorkspaceDiscoveryResult {
  /** 已 resolve 的根目录绝对路径 */
  rootPath: string
  /** 扫描开始时间，epoch 毫秒 */
  scannedAt: number
  projects: DiscoveredProject[]
  warnings: DiscoveryWarning[]
  stats: DiscoveryStats
}

// ============ Service 发现元数据（Phase 3 写入 / Phase 6 复用） ============

/**
 * 挂在 `Service.discovery` 上的发现元数据。
 * Phase 3 只写入 managed / lastDetectedAt / sourcePath；
 * lockedFields 为 Phase 6「重扫合并」预埋：列出的字段在重扫合并时不被覆盖。
 * 该字段**始终可选**，手动创建的 Service 与旧配置里的 Service 都不携带。
 */
export interface ServiceDiscoveryMeta {
  /** 是否由发现流程创建 / 托管 */
  managed: boolean
  /** 最近一次被扫描识别的时间（epoch 毫秒） */
  lastDetectedAt?: number
  /** 识别来源目录（绝对路径），Phase 6 据此做重扫比对 */
  sourcePath?: string
  /** 用户手工改过、重扫时禁止覆盖的字段名列表（Phase 6） */
  lockedFields?: string[]
}

// ============ 批量添加（Phase 3） ============

/**
 * 批量创建 Service 的单条入参。
 * 字段与 main 侧 `CreateServiceInput` 保持结构一致；
 * 这里不 import main 层代码，避免 shared → main 的层级倒置。
 */
export interface DiscoveryServiceInput {
  workspaceId: string
  name: string
  type: 'frontend' | 'node' | 'java' | 'generic'
  cwd: string
  command: string
  args?: string[]
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'custom'
  port?: number
  env?: Record<string, string>
  envFile?: string
  enabled?: boolean
  dependencies?: string[]
  startupDelay?: number
  autoOpenBrowser?: boolean
  openUrl?: string
  shellMode?: boolean
  /** 发现元数据；由渲染层填 `{ managed: true, ... }`，main 侧会再校正一次 */
  discovery?: ServiceDiscoveryMeta
}

/** workspace:applyDiscovery 入参 */
export interface ApplyDiscoveryRequest {
  workspaceId: string
  /** 待创建的服务列表；每条的 workspaceId 会被顶层 workspaceId 强制覆盖 */
  services: DiscoveryServiceInput[]
}

/** system:detectProject 入参（单目录轻量检测） */
export interface DetectProjectRequest {
  /** 待检测的目录绝对路径 */
  path: string
}

// ============ Walker 中间产物 ============

/**
 * DirectoryWalker 的产出。
 * walker 不 import 任何 scanner，只负责给出「候选目录绝对路径列表」。
 */
export interface DirectoryWalkResult {
  candidates: string[]
  warnings: DiscoveryWarning[]
  stats: DiscoveryStats
}

// PX Dev — Workspace Discovery Zod Schema（Phase 1 基线）
//
// 序列化保证：所有 schema 使用 `.strict()`，字段仅含 string / number / boolean / 数组 / 普通对象，
// 不含 z.function() / z.instanceof() / z.date()，因此 parse() 输出天然满足 structured clone。
// Main 侧 handler 出参统一 `return XxxSchema.parse(result)` —— 既是校验也是**净化**
// （strict 会剥离非法多余键，杜绝 FS handle / ChildProcess / Proxy 泄漏）。

import { z } from 'zod'

// ============ 运行时默认值（类型文件保持纯类型，默认值集中在此） ============

/** 发现流程的默认参数，walker / schema 共用同一份来源 */
export const DISCOVERY_DEFAULTS = {
  /** root 自身 depth=0；maxDepth=3 表示最深访问到 root/a/b/c */
  maxDepth: 3,
  maxDirectories: 2000,
  timeout: 15000,
  includeLibrary: false,
} as const

// ============ 基础枚举 ============

export const DiscoveryConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const DiscoveryProjectTypeSchema = z.enum([
  'frontend',
  'node',
  'java',
  'generic',
  'unknown',
])

export const DetectedEndpointTypeSchema = z.enum(['local', 'network', 'health', 'unknown'])

export const DetectedEndpointSourceSchema = z.enum([
  'command',
  'config',
  'env',
  'framework-default',
  'runtime-log',
  'user',
])

export const DiscoveryWarningCodeSchema = z.enum([
  'DISCOVERY_ROOT_NOT_FOUND',
  'DISCOVERY_ROOT_NOT_DIRECTORY',
  'DISCOVERY_PERMISSION_DENIED',
  'DISCOVERY_READ_FAILED',
  'DISCOVERY_DEPTH_LIMIT',
  'DISCOVERY_DIRECTORY_LIMIT',
  'DISCOVERY_TIMEOUT',
  'DISCOVERY_SYMLINK_SKIPPED',
  'DISCOVERY_PARSE_FAILED',
  'DISCOVERY_SCANNER_FAILED',
])

// ============ 证据 / 端点 ============

export const DetectionEvidenceSchema = z
  .object({
    type: z.string().min(1).max(60),
    detail: z.string().max(500),
    source: z.string().max(4096),
  })
  .strict()

export const DetectedEndpointSchema = z
  .object({
    type: DetectedEndpointTypeSchema,
    protocol: z.enum(['http', 'https']).optional(),
    host: z.string().max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    url: z.string().max(2048).optional(),
    source: DetectedEndpointSourceSchema,
    confidence: DiscoveryConfidenceSchema,
  })
  .strict()

// ============ 运行时端点（Phase 5） ============

export const RuntimePortConflictSchema = z
  .object({
    configuredPort: z.number().int().min(1).max(65535),
    runtimePort: z.number().int().min(1).max(65535),
    message: z.string().min(1).max(200),
  })
  .strict()

/**
 * 运行时端点快照。
 * endpoints 上限 10：与 RuntimeEndpointDetector 的单批产出上限一致，防日志洪水。
 */
export const RuntimeEndpointSnapshotSchema = z
  .object({
    serviceId: z.string().min(1).max(64),
    endpoints: z.array(DetectedEndpointSchema).max(10),
    primaryUrl: z.string().max(2048).optional(),
    runtimePort: z.number().int().min(1).max(65535).optional(),
    conflict: RuntimePortConflictSchema.optional(),
    updatedAt: z.number().int().min(0),
  })
  .strict()

/** `runtime:endpoints` 事件 payload；runtime=null 表示已停止 */
export const RuntimeEndpointsPayloadSchema = z
  .object({
    serviceId: z.string().min(1).max(64),
    runtime: RuntimeEndpointSnapshotSchema.nullable(),
  })
  .strict()

/** `workspace:runtimeEndpoints` 入参 */
export const RuntimeEndpointsQuerySchema = z
  .object({
    serviceId: z.string().min(1).max(64).optional(),
  })
  .strict()

/** `workspace:runtimeEndpoints` 出参：快照数组（出参 parse 起消毒作用） */
export const RuntimeEndpointSnapshotListSchema = z.array(RuntimeEndpointSnapshotSchema).max(200)

// ============ 项目 ============

export const DiscoveredProjectSchema = z
  .object({
    id: z.string().min(1).max(64),
    path: z.string().min(1).max(4096),
    relativePath: z.string().min(1).max(4096),
    name: z.string().min(1).max(200),
    projectType: DiscoveryProjectTypeSchema,
    // —— Phase 2 已填充 / Phase 4 待填充，全部 optional ——
    framework: z.string().max(60).optional(),
    packageManager: z.string().max(30).optional(),
    command: z.string().max(300).optional(),
    args: z.array(z.string().max(300)).max(50).optional(),
    detectedPort: z.number().int().min(1).max(65535).optional(),
    endpoints: z.array(DetectedEndpointSchema).max(30).optional(),
    isLibrary: z.boolean().optional(),
    parentProjectId: z.string().max(64).optional(),
    /** 映射后的 Service.type（unknown → 'generic'） */
    suggestedServiceType: z.enum(['frontend', 'node', 'java', 'generic']).optional(),
    /** UI 默认是否勾选 */
    suggestedSelected: z.boolean().optional(),
    // —— Phase 1 必填 ——
    confidence: DiscoveryConfidenceSchema,
    evidence: z.array(DetectionEvidenceSchema).max(100),
    configFiles: z.array(z.string().max(255)).max(50),
  })
  .strict()

// ============ 告警 / 统计 ============

export const DiscoveryWarningSchema = z
  .object({
    code: DiscoveryWarningCodeSchema,
    message: z.string().max(500),
    path: z.string().max(4096).optional(),
    severity: z.enum(['info', 'warn', 'error']).optional(),
  })
  .strict()

export const DiscoveryStatsSchema = z
  .object({
    scannedDirectories: z.number().int().min(0),
    maxDepthReached: z.number().int().min(0),
    truncated: z.boolean(),
    elapsedMs: z.number().int().min(0),
    skippedDirectories: z.number().int().min(0).optional(),
  })
  .strict()

// ============ 请求 / 结果 ============

export const WorkspaceDiscoveryOptionsSchema = z
  .object({
    maxDepth: z.number().int().min(1).max(8).default(DISCOVERY_DEFAULTS.maxDepth),
    maxDirectories: z
      .number()
      .int()
      .min(1)
      .max(20000)
      .default(DISCOVERY_DEFAULTS.maxDirectories),
    timeout: z.number().int().min(1000).max(120000).default(DISCOVERY_DEFAULTS.timeout),
    includeLibrary: z.boolean().default(DISCOVERY_DEFAULTS.includeLibrary),
    extraIgnores: z.array(z.string().min(1).max(120)).max(100).default([]),
  })
  .strict()

export const WorkspaceDiscoveryRequestSchema = z
  .object({
    rootPath: z.string().min(1).max(4096),
    workspaceId: z.string().min(1).max(64).optional(),
    /** 逐字段可选：未传的项由 walker 回落到 DISCOVERY_DEFAULTS */
    options: WorkspaceDiscoveryOptionsSchema.partial().optional(),
  })
  .strict()

export const WorkspaceDiscoveryResultSchema = z
  .object({
    rootPath: z.string().min(1).max(4096),
    /** epoch 毫秒 */
    scannedAt: z.number().int().min(0),
    projects: z.array(DiscoveredProjectSchema).max(500),
    warnings: z.array(DiscoveryWarningSchema).max(200),
    stats: DiscoveryStatsSchema,
  })
  .strict()

// ============ Service 发现元数据（Phase 3） ============

/**
 * `Service.discovery` 的校验 schema。
 * 与 ServiceSchema 一样保持 optional，绝不影响旧配置里没有该字段的 Service。
 */
export const ServiceDiscoveryMetaSchema = z
  .object({
    managed: z.boolean(),
    lastDetectedAt: z.number().int().min(0).optional(),
    sourcePath: z.string().max(4096).optional(),
    lockedFields: z.array(z.string().max(60)).max(50).optional(),
  })
  .strict()

/** system:detectProject 的出参：命中则为 DiscoveredProject，未命中为 null */
export const DetectProjectResultSchema = DiscoveredProjectSchema.nullable()

// ============ 推导类型（便于测试与 handler 直接复用） ============

export type WorkspaceDiscoveryRequestParsed = z.infer<typeof WorkspaceDiscoveryRequestSchema>
export type WorkspaceDiscoveryResultParsed = z.infer<typeof WorkspaceDiscoveryResultSchema>
export type DiscoveredProjectParsed = z.infer<typeof DiscoveredProjectSchema>
export type ServiceDiscoveryMetaParsed = z.infer<typeof ServiceDiscoveryMetaSchema>
export type RuntimeEndpointSnapshotParsed = z.infer<typeof RuntimeEndpointSnapshotSchema>
export type RuntimeEndpointsPayloadParsed = z.infer<typeof RuntimeEndpointsPayloadSchema>

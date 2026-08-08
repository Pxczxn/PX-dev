// PX Dev — IPC Request Schemas (Zod)
// All IPC handler input validation schemas

import { z } from 'zod'

// ===== 通用 =====
const uuidSchema = z.string().min(1)
const pathSchema = z.string().min(1)
const portSchema = z.number().int().min(1).max(65535)

// ===== Workspace =====
export const ListWorkspacesSchema = z.object({}).optional()

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  rootPath: pathSchema.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().optional(),
  favorite: z.boolean().default(false),
  startMode: z.enum(['parallel', 'sequential', 'dependency']).default('parallel'),
})

export const UpdateWorkspaceSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  rootPath: pathSchema.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().optional(),
  favorite: z.boolean().optional(),
  startMode: z.enum(['parallel', 'sequential', 'dependency']).optional(),
})

export const DeleteWorkspaceSchema = z.object({
  id: uuidSchema,
})

// ===== Service =====
export const ListServicesSchema = z.object({
  workspaceId: uuidSchema.optional(),
})

export const CreateServiceSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string().min(1).max(100),
  type: z.enum(['frontend', 'node', 'java', 'generic']),
  cwd: pathSchema,
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun', 'custom']).optional(),
  port: portSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: pathSchema.optional(),
  enabled: z.boolean().default(true),
  dependencies: z.array(uuidSchema).default([]),
  startupDelay: z.number().int().min(0).max(60000).optional(),
  autoOpenBrowser: z.boolean().optional(),
  openUrl: z.string().url().optional(),
  healthCheck: z
    .object({
      type: z.enum(['none', 'port', 'http']),
      target: z.string().optional(),
      timeoutMs: z.number().int().min(100).max(60000).optional(),
      intervalMs: z.number().int().min(500).max(60000).optional(),
      retries: z.number().int().min(0).max(100).optional(),
    })
    .optional(),
  shellMode: z.boolean().default(false),
})

export const UpdateServiceSchema = CreateServiceSchema.partial().extend({
  id: uuidSchema,
})

export const DeleteServiceSchema = z.object({ id: uuidSchema })

// ===== Service 操作 =====
export const StartServiceSchema = z.object({ serviceId: uuidSchema })
export const StopServiceSchema = z.object({ serviceId: uuidSchema })
export const RestartServiceSchema = z.object({ serviceId: uuidSchema })
export const ForceKillServiceSchema = z.object({ serviceId: uuidSchema })
export const GetRuntimeSchema = z.object({ serviceId: uuidSchema.optional() })
export const StartWorkspaceSchema = z.object({ workspaceId: uuidSchema })
export const StopWorkspaceSchema = z.object({ workspaceId: uuidSchema })

// ===== Log =====
export const LogSubscribeSchema = z.object({ serviceId: uuidSchema })
export const LogUnsubscribeSchema = z.object({ serviceId: uuidSchema })
export const LogClearSchema = z.object({ serviceId: uuidSchema })
export const LogHistorySchema = z.object({
  serviceId: uuidSchema,
  limit: z.number().int().min(1).max(10000).optional(),
})
export const LogExportSchema = z.object({
  serviceId: uuidSchema,
  savePath: pathSchema.optional(),
})

// log:batch 事件 payload（M→R）
export const LogBatchEventSchema = z.object({
  serviceId: uuidSchema,
  entries: z.array(
    z.object({
      serviceId: uuidSchema,
      timestamp: z.number(),
      stream: z.enum(['stdout', 'stderr']),
      text: z.string(),
    }),
  ),
})

// ===== Environment =====
export const EnvironmentDetectSchema = z.object({}).optional()
export const EnvironmentDetectSingleSchema = z.object({
  name: z.enum(['node', 'npm', 'pnpm', 'yarn', 'java', 'mvn', 'gradle', 'git']),
})

// ===== Port =====
export const PortCheckSchema = z.object({ port: portSchema })
export const PortOwnerSchema = z.object({ port: portSchema })
export const PortKillSchema = z.object({ pid: z.number().int().positive() })
export const PortWaitListeningSchema = z.object({
  port: portSchema,
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
})

// ===== System =====
export const SystemOpenPathSchema = z.object({ path: pathSchema })
export const SystemOpenExternalSchema = z.object({ url: z.string().url() })
export const SystemSelectDirectorySchema = z.object({}).optional()
export const SystemScanDirectorySchema = z.object({ path: pathSchema })
export const SystemShowItemSchema = z.object({ path: pathSchema })

// ===== App =====
export const AppGetSettingsSchema = z.object({}).optional()
export const AppUpdateSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  closeBehavior: z.enum(['tray', 'quit', 'ask']).optional(),
  maxLogLines: z.number().int().min(500).max(50000).optional(),
  startMinimized: z.boolean().optional(),
  autoRestoreLastSession: z.boolean().optional(),
  startupInterval: z.number().int().min(0).max(30000).optional(),
  showTimestamp: z.boolean().optional(),
  defaultBrowser: z.string().optional(),
})
export const AppQuitSchema = z.object({}).optional()
export const AppMinimizeSchema = z.object({}).optional()

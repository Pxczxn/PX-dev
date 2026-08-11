// PX Dev — Service Zod Schema

import { z } from 'zod'
import { ServiceDiscoveryMetaSchema } from './discovery.schema'

export const HealthCheckConfigSchema = z.object({
  type: z.enum(['none', 'port', 'http']),
  target: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(60000).optional(),
  intervalMs: z.number().int().min(500).max(60000).optional(),
  retries: z.number().int().min(0).max(100).optional(),
})

export const ServiceSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  type: z.enum(['frontend', 'node', 'java', 'generic']),
  role: z.enum(['frontend', 'backend']),
  cwd: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun', 'custom']).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().min(1).optional(),
  enabled: z.boolean(),
  dependencies: z.array(z.string().min(1)),
  startupDelay: z.number().int().min(0).max(60000).optional(),
  autoOpenBrowser: z.boolean().optional(),
  openUrl: z.string().url().optional(),
  healthCheck: HealthCheckConfigSchema.optional(),
  shellMode: z.boolean().optional(),
  /** 发现元数据（可选）；手动创建 / 旧配置的 Service 不含该字段 */
  discovery: ServiceDiscoveryMetaSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ServiceParsed = z.infer<typeof ServiceSchema>
export type HealthCheckConfigParsed = z.infer<typeof HealthCheckConfigSchema>

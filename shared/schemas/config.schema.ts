// PX Dev — AppConfig Zod Schema

import { z } from 'zod'
import { WorkspaceSchema } from './workspace.schema'
import { ServiceSchema } from './service.schema'

export const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  closeBehavior: z.enum(['tray', 'quit', 'ask']),
  maxLogLines: z.number().int().min(500).max(50000),
  startMinimized: z.boolean(),
  autoRestoreLastSession: z.boolean(),
  startupInterval: z.number().int().min(0).max(30000),
  showTimestamp: z.boolean(),
  defaultBrowser: z.string(),
  /** 自定义数据目录路径，留空表示使用默认位置 */
  dataPath: z.string().optional(),
})

export const AppConfigSchema = z.object({
  version: z.number().int().min(1),
  settings: SettingsSchema,
  workspaces: z.array(WorkspaceSchema),
  services: z.array(ServiceSchema),
})

export type SettingsParsed = z.infer<typeof SettingsSchema>
export type AppConfigParsed = z.infer<typeof AppConfigSchema>

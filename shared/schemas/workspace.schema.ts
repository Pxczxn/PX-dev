// PX Dev — Workspace Zod Schema

import { z } from 'zod'

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  rootPath: z.string().min(1).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().optional(),
  favorite: z.boolean(),
  startMode: z.enum(['parallel', 'sequential', 'dependency']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type WorkspaceParsed = z.infer<typeof WorkspaceSchema>

// PX Dev — Workspace IPC Handlers

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  DeleteWorkspaceSchema,
  ListServicesSchema,
  CreateServiceSchema,
  UpdateServiceSchema,
  DeleteServiceSchema,
} from '@shared/schemas/ipc.schema'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import { validate } from './index'

export function registerWorkspaceHandlers(wm: WorkspaceManager): void {
  // workspace:list
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, async () => {
    return wm.listWorkspaces()
  })

  // workspace:create
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE, async (_event, input: unknown) => {
    const data = validate(CreateWorkspaceSchema, input)
    return wm.createWorkspace(data)
  })

  // workspace:update
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UPDATE, async (_event, input: unknown) => {
    const data = validate(UpdateWorkspaceSchema, input)
    const { id, ...patch } = data
    return wm.updateWorkspace(id, patch)
  })

  // workspace:delete
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DELETE, async (_event, input: unknown) => {
    const data = validate(DeleteWorkspaceSchema, input)
    wm.deleteWorkspace(data.id)
    return { success: true }
  })

  // service:list (also here since it's workspace-related CRUD)
  ipcMain.handle(IPC_CHANNELS.SERVICE_LIST, async (_event, input: unknown) => {
    const data = validate(ListServicesSchema, input)
    return wm.listServices(data?.workspaceId)
  })

  // service:create
  ipcMain.handle(IPC_CHANNELS.SERVICE_CREATE, async (_event, input: unknown) => {
    const data = validate(CreateServiceSchema, input)
    return wm.createService(data)
  })

  // service:update
  ipcMain.handle(IPC_CHANNELS.SERVICE_UPDATE, async (_event, input: unknown) => {
    const data = validate(UpdateServiceSchema, input)
    const { id, ...patch } = data
    return wm.updateService(id, patch)
  })

  // service:delete
  ipcMain.handle(IPC_CHANNELS.SERVICE_DELETE, async (_event, input: unknown) => {
    const data = validate(DeleteServiceSchema, input)
    wm.deleteService(data.id)
    return { success: true }
  })
}

// PX Dev — Environment IPC Handlers

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { EnvironmentDetectSchema, EnvironmentDetectSingleSchema } from '@shared/schemas/ipc.schema'
import type { EnvironmentManager } from '../managers/EnvironmentManager'
import { validate } from './index'

export function registerEnvironmentHandlers(em: EnvironmentManager): void {
  // environment:detect
  ipcMain.handle(IPC_CHANNELS.ENVIRONMENT_DETECT, async () => {
    validate(EnvironmentDetectSchema, {})
    return em.detectAll()
  })

  // environment:detectSingle
  ipcMain.handle(IPC_CHANNELS.ENVIRONMENT_DETECT_SINGLE, async (_event, input: unknown) => {
    const data = validate(EnvironmentDetectSingleSchema, input)
    return em.detect(data.name)
  })
}

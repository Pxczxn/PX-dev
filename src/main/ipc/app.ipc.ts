// PX Dev — App IPC Handlers

import { ipcMain, app } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { AppGetSettingsSchema, AppUpdateSettingsSchema, AppQuitSchema, AppMinimizeSchema } from '@shared/schemas/ipc.schema'
import type { ConfigManager } from '../managers/ConfigManager'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import { logger } from '../utils/logger'
import { validate } from './index'

export function registerAppHandlers(
  configManager: ConfigManager,
  wm: WorkspaceManager,
  quitCallback: () => void,
  minimizeCallback: () => void,
): void {
  // app:getSettings
  ipcMain.handle(IPC_CHANNELS.APP_GET_SETTINGS, async () => {
    validate(AppGetSettingsSchema, {})
    return wm.getSettings()
  })

  // app:updateSettings
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_SETTINGS, async (_event, input: unknown) => {
    try {
      const data = validate(AppUpdateSettingsSchema, input)
      return wm.updateSettings(data)
    } catch (err) {
      logger.error(`[app:updateSettings] failed: ${(err as Error).message}`)
      throw err
    }
  })

  // app:getVersion
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, async () => {
    return app.getVersion()
  })

  // app:quit
  ipcMain.handle(IPC_CHANNELS.APP_QUIT, async () => {
    validate(AppQuitSchema, {})
    quitCallback()
    return { success: true }
  })

  // app:minimize
  ipcMain.handle(IPC_CHANNELS.APP_MINIMIZE, async () => {
    validate(AppMinimizeSchema, {})
    minimizeCallback()
    return { success: true }
  })
}

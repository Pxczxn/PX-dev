// PX Dev — App IPC Handlers

import { ipcMain, app } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { AppGetSettingsSchema, AppUpdateSettingsSchema, AppQuitSchema, AppMinimizeSchema } from '@shared/schemas/ipc.schema'
import type { ConfigManager } from '../managers/ConfigManager'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import { logger } from '../utils/logger'
import { getConfigDir } from '../utils/paths'
import { setDataPathInRegistry } from '../utils/registry'
import { validate } from './index'
import { existsSync, renameSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'fs'
import { join } from 'path'

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

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

  // app:getDataPath — returns the currently effective data path
  ipcMain.handle(IPC_CHANNELS.APP_GET_DATA_PATH, async () => {
    return getConfigDir()
  })

  // app:selectDataPath — opens dialog, writes to registry, migrates data, restarts
  ipcMain.handle(IPC_CHANNELS.APP_SELECT_DATA_PATH, async () => {
    const currentPath = getConfigDir()

    // Open directory picker
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      title: '选择数据存放目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, reason: 'cancelled' }
    }

    const newPath = result.filePaths[0]
    if (newPath === currentPath) {
      return { success: false, reason: 'same' }
    }

    // Migrate existing data to new location
    if (existsSync(currentPath)) {
      const files = readdirSync(currentPath)
      if (files.length > 0) {
        logger.info(`Migrating data from "${currentPath}" to "${newPath}"`)
        try {
          copyDirRecursive(currentPath, newPath)
        } catch (err) {
          logger.error(`Data migration failed: ${(err as Error).message}`)
          throw new Error(`数据迁移失败: ${(err as Error).message}`)
        }
      }
    }

    // Write new path to registry
    setDataPathInRegistry(newPath)
    logger.info(`Data path changed to "${newPath}", restarting...`)

    // Restart the app
    app.relaunch({ args: process.argv.slice(1) })
    app.exit(0)

    return { success: true, newPath }
  })
}

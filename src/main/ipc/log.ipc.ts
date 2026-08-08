// PX Dev — Log IPC Handlers

import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'fs'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import {
  LogSubscribeSchema,
  LogUnsubscribeSchema,
  LogClearSchema,
  LogHistorySchema,
  LogExportSchema,
} from '@shared/schemas/ipc.schema'
import type { LogManager } from '../managers/LogManager'
import { validate } from './index'

export function registerLogHandlers(lm: LogManager): void {
  // log:subscribe
  ipcMain.handle(IPC_CHANNELS.LOG_SUBSCRIBE, async (_event, input: unknown) => {
    const data = validate(LogSubscribeSchema, input)
    lm.subscribe(data.serviceId)
    return { success: true }
  })

  // log:unsubscribe
  ipcMain.handle(IPC_CHANNELS.LOG_UNSUBSCRIBE, async (_event, input: unknown) => {
    const data = validate(LogUnsubscribeSchema, input)
    lm.unsubscribe(data.serviceId)
    return { success: true }
  })

  // log:clear
  ipcMain.handle(IPC_CHANNELS.LOG_CLEAR, async (_event, input: unknown) => {
    const data = validate(LogClearSchema, input)
    lm.clear(data.serviceId)
    return { success: true }
  })

  // log:history
  ipcMain.handle(IPC_CHANNELS.LOG_HISTORY, async (_event, input: unknown) => {
    const data = validate(LogHistorySchema, input)
    return lm.getHistory(data.serviceId, data.limit)
  })

  // log:export
  ipcMain.handle(IPC_CHANNELS.LOG_EXPORT, async (_event, input: unknown) => {
    const data = validate(LogExportSchema, input)
    const text = lm.export(data.serviceId)

    let savePath = data.savePath
    if (!savePath) {
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: '导出日志',
        defaultPath: `log-${data.serviceId}-${Date.now()}.txt`,
        filters: [{ name: 'Text Files', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }],
      })
      if (result.canceled || !result.filePath) {
        return { success: false, message: 'User cancelled' }
      }
      savePath = result.filePath
    }

    writeFileSync(savePath, text, 'utf-8')
    return { success: true, path: savePath }
  })
}

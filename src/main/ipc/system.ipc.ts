// PX Dev — System IPC Handlers

import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import {
  SystemOpenPathSchema,
  SystemOpenExternalSchema,
  SystemSelectDirectorySchema,
  SystemScanDirectorySchema,
  SystemShowItemSchema,
} from '@shared/schemas/ipc.schema'
import { ScannerRegistry } from '../scanners'
import { validate } from './index'

export function registerSystemHandlers(scannerRegistry: ScannerRegistry): void {
  // system:openPath
  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_PATH, async (_event, input: unknown) => {
    const data = validate(SystemOpenPathSchema, input)
    await shell.openPath(data.path)
    return { success: true }
  })

  // system:openExternal
  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_event, input: unknown) => {
    const data = validate(SystemOpenExternalSchema, input)
    await shell.openExternal(data.url)
    return { success: true }
  })

  // system:selectDirectory
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SELECT_DIRECTORY, async (event) => {
    validate(SystemSelectDirectorySchema, {})
    // 绑定发起请求的窗口，使对话框以模态方式附着在主窗口上，避免被窗口遮挡
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // system:scanDirectory
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SCAN_DIRECTORY, async (_event, input: unknown) => {
    const data = validate(SystemScanDirectorySchema, input)
    return scannerRegistry.scan(data.path)
  })

  // system:showItemInFolder
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SHOW_ITEM, async (_event, input: unknown) => {
    const data = validate(SystemShowItemSchema, input)
    shell.showItemInFolder(data.path)
    return { success: true }
  })
}

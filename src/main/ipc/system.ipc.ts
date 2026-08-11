// PX Dev — System IPC Handlers

import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { ERROR_CODES } from '@shared/constants/status'
import {
  SystemOpenPathSchema,
  SystemOpenExternalSchema,
  SystemSelectDirectorySchema,
  SystemScanDirectorySchema,
  SystemShowItemSchema,
} from '@shared/schemas/ipc.schema'
import { ScannerRegistry } from '../scanners'
import { logger } from '../utils/logger'
import { validate, IpcError } from './index'

/**
 * 解析发起 IPC 请求的父窗口，用于让原生对话框以模态方式附着主窗口。
 *
 * 任何异常/边界情况（webContents 已销毁、窗口已关闭、宿主环境不支持）
 * 都必须降级为 null 而不是让整个 handler 失败 —— 没有父窗口时对话框
 * 依然能以非模态方式打开，功能不受影响。
 */
function resolveParentWindow(sender: Electron.WebContents): BrowserWindow | null {
  try {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) {
      return null
    }
    // 真实 BrowserWindow 一定有 isDestroyed；判空是为了兼容测试替身
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) {
      return null
    }
    return win
  } catch (err) {
    logger.warn(`system:selectDirectory 获取父窗口失败，降级为无父窗口: ${String(err)}`)
    return null
  }
}

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
    const parentWindow = resolveParentWindow(event.sender)

    const options: Electron.OpenDialogOptions = {
      title: '选择文件夹',
      // createDirectory 仅在 macOS 生效，其余平台由系统对话框自带新建目录能力
      properties: ['openDirectory', 'createDirectory'],
    }

    try {
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    } catch (err) {
      // 主进程留痕 + 把可读原因带回渲染层，避免只剩一句无信息量的「选择目录失败」
      const reason = err instanceof Error ? err.message : String(err)
      logger.error(`system:selectDirectory 打开目录对话框失败: ${reason}`)
      throw new IpcError(ERROR_CODES.INTERNAL_ERROR, `打开目录选择对话框失败: ${reason}`)
    }
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

// PX Dev — WindowManager
// BrowserWindow lifecycle + close behavior strategy

import { BrowserWindow, shell, dialog, app } from 'electron'
import { join } from 'path'
import type { ProcessManager } from '../managers/ProcessManager'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import { logger } from '../utils/logger'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private processManager: ProcessManager
  private workspaceManager: WorkspaceManager

  constructor(processManager: ProcessManager, workspaceManager: WorkspaceManager) {
    this.processManager = processManager
    this.workspaceManager = workspaceManager
  }

  /** Create the main BrowserWindow */
  createWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      show: false, // Show on 'ready-to-show' to avoid flash
      title: 'PX Dev',
      backgroundColor: '#0f0f1a',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    // Show window when ready (prevents white flash)
    this.mainWindow.on('ready-to-show', () => {
      const settings = this.workspaceManager.getSettings()
      if (!settings.startMinimized) {
        this.mainWindow?.show()
      }
    })

    // Handle close → delegate to close behavior strategy
    this.mainWindow.on('close', (event) => {
      event.preventDefault()
      this.handleClose()
    })

    // Open external links in browser (not in Electron)
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // Load renderer
    this.loadRenderer()

    logger.info('WindowManager: main window created')
    return this.mainWindow
  }

  /** Load the renderer (dev server or file://) */
  private loadRenderer(): void {
    if (isDev) {
      // Dev server URL from electron-vite
      const devServerUrl = process.env['ELECTRON_RENDERER_URL']
      if (devServerUrl) {
        this.mainWindow?.loadURL(devServerUrl)
      } else {
        logger.warn('ELECTRON_RENDERER_URL not set, cannot load renderer in dev mode')
      }
    } else {
      // Production: load built file
      const rendererPath = join(__dirname, '../renderer/index.html')
      this.mainWindow?.loadFile(rendererPath)
    }
  }

  /** Get the main window (may be null) */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /** Show the main window */
  show(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.show()
      this.mainWindow.focus()
    }
  }

  /** Hide the main window (to tray) */
  hide(): void {
    this.mainWindow?.hide()
  }

  /** Handle close based on settings.closeBehavior */
  async handleClose(): Promise<void> {
    const settings = this.workspaceManager.getSettings()

    switch (settings.closeBehavior) {
      case 'tray':
        this.hide()
        break
      case 'quit':
        await this.handleQuit()
        break
      case 'ask':
      default:
        await this.handleAskClose()
        break
    }
  }

  /** Ask user what to do on close */
  private async handleAskClose(): Promise<void> {
    const runtimes = this.processManager.getAllRuntimes()
    const runningCount = runtimes.filter(
      (r) => r.status === 'running' || r.status === 'starting',
    ).length

    if (runningCount > 0) {
      const result = await dialog.showMessageBox(this.mainWindow!, {
        type: 'warning',
        title: '确认关闭',
        message: `有 ${runningCount} 个服务正在运行`,
        detail: '关闭窗口前请选择操作',
        buttons: ['最小化到托盘', '停止全部并退出', '取消'],
        defaultId: 0,
        cancelId: 2,
      })

      if (result.response === 0) {
        this.hide()
      } else if (result.response === 1) {
        await this.processManager.stopAll()
        this.destroyWindow()
        app.quit()
      }
      // response === 2: cancel, do nothing
    } else {
      // No running services, just minimize to tray
      this.hide()
    }
  }

  /** Handle quit (stop all + exit) */
  private async handleQuit(): Promise<void> {
    const runtimes = this.processManager.getAllRuntimes()
    const hasRunning = runtimes.some(
      (r) => r.status === 'running' || r.status === 'starting',
    )

    if (hasRunning) {
      const result = await dialog.showMessageBox(this.mainWindow!, {
        type: 'warning',
        title: '确认退出',
        message: '有服务正在运行',
        detail: '退出前是否停止所有运行中的服务？',
        buttons: ['停止全部并退出', '后台继续运行', '取消'],
        defaultId: 0,
        cancelId: 2,
      })

      if (result.response === 0) {
        await this.processManager.stopAll()
        this.destroyWindow()
        app.quit()
      } else if (result.response === 1) {
        this.destroyWindow()
        app.quit()
      }
    } else {
      this.destroyWindow()
      app.quit()
    }
  }

  /** Destroy the window (remove close listener first to prevent loop) */
  private destroyWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.removeAllListeners('close')
      this.mainWindow.destroy()
      this.mainWindow = null
    }
  }

  /** Send an event to the renderer via webContents */
  send(channel: string, payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload)
    }
  }
}

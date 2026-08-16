// PX Dev — TrayManager
// System tray + running services display + quit strategy

import { Tray, Menu, nativeImage, dialog, app, type NativeImage } from 'electron'
import { join } from 'path'
import type { ProcessManager } from '../managers/ProcessManager'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import type { WindowManager } from '../window/WindowManager'
import { logger } from '../utils/logger'

export class TrayManager {
  private tray: Tray | null = null
  private processManager: ProcessManager
  private workspaceManager: WorkspaceManager
  private windowManager: WindowManager

  constructor(
    processManager: ProcessManager,
    workspaceManager: WorkspaceManager,
    windowManager: WindowManager,
  ) {
    this.processManager = processManager
    this.workspaceManager = workspaceManager
    this.windowManager = windowManager
  }

  /** Create the system tray */
  create(): void {
    const iconPath = this.getIconPath()
    let icon: NativeImage

    try {
      icon = nativeImage.createFromPath(iconPath)
      if (icon.isEmpty()) {
        // Fallback: create a small empty icon
        icon = nativeImage.createEmpty()
        logger.warn('Tray icon not found, using empty icon')
      }
    } catch {
      icon = nativeImage.createEmpty()
      logger.warn('Failed to load tray icon, using empty icon')
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('PX Dev — 进程管理工具')

    // Set up runtime change callback to update menu
    this.processManager.setRuntimeChangeCallback(() => {
      this.updateMenu()
    })

    // Double-click → show main window
    this.tray.on('double-click', () => {
      this.windowManager.show()
    })

    this.updateMenu()
    logger.info('TrayManager created')
  }

  /** Update the tray menu with current running services */
  updateMenu(): void {
    if (!this.tray) return

    const runtimes = this.processManager.getAllRuntimes()
    const runningCount = runtimes.filter(
      (r) => r.status === 'running' || r.status === 'starting',
    ).length

    const services = this.workspaceManager.listServices()
    const runningServices = runtimes.filter(
      (r) => r.status === 'running' || r.status === 'starting',
    )

    // Build workspace submenu for running services
    const runningServiceItems = runningServices.map((rt) => {
      const svc = services.find((s) => s.id === rt.serviceId)
      return {
        label: `${svc?.name ?? rt.serviceId} (${rt.status})`,
        click: () => {
          this.windowManager.show()
        },
      }
    })

    const menu = Menu.buildFromTemplate([
      {
        label: '打开 PX Dev',
        click: () => this.windowManager.show(),
      },
      { type: 'separator' },
      {
        label: `运行中服务: ${runningCount}`,
        enabled: false,
      },
      ...(runningServiceItems.length > 0
        ? runningServiceItems
        : [{ label: '无运行中服务', enabled: false }]),
      { type: 'separator' },
      {
        label: '全部停止',
        enabled: runningCount > 0,
        click: () => {
          this.processManager.stopAll().catch((e) => {
            logger.error(`Stop all failed: ${e.message}`)
          })
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => this.handleQuit(),
      },
    ])

    this.tray.setContextMenu(menu)
  }

  /** Handle quit with running service check */
  async handleQuit(): Promise<void> {
    const runtimes = this.processManager.getAllRuntimes()
    const runningCount = runtimes.filter(
      (r) => r.status === 'running' || r.status === 'starting',
    ).length

    if (runningCount > 0) {
      const mainWindow = this.windowManager.getMainWindow()
      const options = {
        type: 'warning' as const,
        title: '确认退出',
        message: `有 ${runningCount} 个服务正在运行`,
        detail: '退出前是否停止所有运行中的服务？',
        buttons: ['停止全部并退出', '后台继续运行', '取消'],
        defaultId: 0,
        cancelId: 2,
      }
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)

      if (result.response === 0) {
        // Stop all and quit
        await this.processManager.stopAll()
        app.quit()
      } else if (result.response === 1) {
        // Continue in background
        app.quit()
      }
      // response === 2: cancel, do nothing
    } else {
      app.quit()
    }
  }

  /** Destroy the tray */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
      logger.info('TrayManager destroyed')
    }
  }

  /** Get tray icon path */
  private getIconPath(): string {
    // 开发环境和生产环境都从 resources 目录读取
    const isDev = !!process.env['ELECTRON_RENDERER_URL']
    
    if (isDev) {
      // 开发环境：从项目根目录的 resources 文件夹
      return join(process.cwd(), 'resources', 'tray-icon.png')
    } else {
      // 生产环境：从打包后的 resources 文件夹
      return join(process.resourcesPath, 'tray-icon.png')
    }
  }
}

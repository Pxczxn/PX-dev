// PX Dev — Main Process Entry
// App lifecycle + window creation + IPC registration + tray

import { app, BrowserWindow } from 'electron'
import { ConfigManager } from './managers/ConfigManager'
import { LogManager } from './managers/LogManager'
import { ProcessManager } from './managers/ProcessManager'
import { PortManager } from './managers/PortManager'
import { WorkspaceManager } from './managers/WorkspaceManager'
import { EnvironmentManager } from './managers/EnvironmentManager'
import { ScannerRegistry } from './scanners'
import { TrayManager } from './tray/TrayManager'
import { WindowManager } from './window/WindowManager'
import { registerAllHandlers } from './ipc'
import { logger } from './utils/logger'

// ============ Global manager instances ============
let configManager: ConfigManager
let logManager: LogManager
let processManager: ProcessManager
let portManager: PortManager
let workspaceManager: WorkspaceManager
let environmentManager: EnvironmentManager
let scannerRegistry: ScannerRegistry
let trayManager: TrayManager
let windowManager: WindowManager

// ============ Single instance lock ============
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (windowManager) {
      windowManager.show()
    }
  })

  app.whenReady().then(() => {
    initializeApp()
  })
}

// ============ App initialization ============
function initializeApp(): void {
  logger.info('PX Dev starting...')

  // 1. Load config
  configManager = new ConfigManager()
  logger.info('ConfigManager loaded')

  // 2. Initialize managers
  logManager = new LogManager(configManager.get().settings.maxLogLines)
  portManager = new PortManager()
  processManager = new ProcessManager(logManager, portManager)
  workspaceManager = new WorkspaceManager(configManager, processManager)
  environmentManager = new EnvironmentManager()
  scannerRegistry = new ScannerRegistry()

  // Wire up dependencies
  processManager.setPortManager(portManager)
  workspaceManager.setProcessManager(processManager)

  // 3. Create window manager
  windowManager = new WindowManager(processManager, workspaceManager)

  // 4. Register IPC handlers
  registerAllHandlers(
    {
      configManager,
      processManager,
      logManager,
      portManager,
      workspaceManager,
      environmentManager,
      scannerRegistry,
    },
    (channel, payload) => windowManager.send(channel, payload),
    {
      onQuit: () => {
        processManager.stopAll().then(() => {
          app.quit()
        })
      },
      onMinimize: () => {
        windowManager.hide()
      },
    },
  )

  // 5. Create window
  windowManager.createWindow()

  // 6. Create tray
  trayManager = new TrayManager(processManager, workspaceManager, windowManager)
  trayManager.create()

  // 7. Mark previously-running processes as unknown (app restart scenario)
  processManager.markAllAsUnknown()

  logger.info('PX Dev initialized successfully')
}

// ============ App lifecycle handlers ============
let isQuitting = false

app.on('window-all-closed', () => {
  // On macOS, keep app running. On other platforms, quit.
  // But for PX Dev, we use tray, so don't quit on window close.
  // The close handler in WindowManager prevents the window from actually closing.
})

app.on('before-quit', async (event) => {
  // Guard against re-entry (app.quit() may be called from multiple places)
  if (isQuitting) return
  // Prevent immediate quit — stop all processes first
  if (processManager) {
    isQuitting = true
    event.preventDefault()
    logger.info('Stopping all processes before quit...')
    await processManager.stopAll()
    logManager.stopFlushTimer()
    app.exit()
  }
})

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
    windowManager.createWindow()
  }
})

// ============ Cleanup on exit ============
process.on('exit', () => {
  logManager?.stopFlushTimer()
  trayManager?.destroy()
})

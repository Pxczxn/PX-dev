// PX Dev — IPC Handler Registry + Utilities
// registerAllHandlers() + Zod validation + error wrapping

import { z } from 'zod'
import { ERROR_CODES } from '@shared/constants/status'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import type { ConfigManager } from '../managers/ConfigManager'
import type { ProcessManager } from '../managers/ProcessManager'
import type { LogManager } from '../managers/LogManager'
import type { PortManager } from '../managers/PortManager'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import type { EnvironmentManager } from '../managers/EnvironmentManager'
import { ScannerRegistry } from '../scanners'

import { registerWorkspaceHandlers } from './workspace.ipc'
import { registerServiceHandlers } from './service.ipc'
import { registerLogHandlers } from './log.ipc'
import { registerEnvironmentHandlers } from './environment.ipc'
import { registerPortHandlers } from './port.ipc'
import { registerSystemHandlers } from './system.ipc'
import { registerAppHandlers } from './app.ipc'

// ============ Utility: Custom IPC Error ============
export class IpcError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'IpcError'
  }
}

// ============ Utility: Zod Validation ============
/**
 * Validate input against a Zod schema.
 * Throws IpcError(VALIDATION_ERROR) on failure.
 */
export function validate<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new IpcError(ERROR_CODES.VALIDATION_ERROR, `参数校验失败: ${issues}`)
  }
  return result.data
}

// ============ Register All Handlers ============
export interface ManagerContainer {
  configManager: ConfigManager
  processManager: ProcessManager
  logManager: LogManager
  portManager: PortManager
  workspaceManager: WorkspaceManager
  environmentManager: EnvironmentManager
  scannerRegistry: ScannerRegistry
}

/**
 * Register all IPC handlers.
 * @param managers - All manager instances
 * @param sender - Function to send events to renderer (webContents.send)
 * @param callbacks - App lifecycle callbacks (quit, minimize)
 */
export function registerAllHandlers(
  managers: ManagerContainer,
  sender: (channel: string, payload: unknown) => void,
  callbacks: {
    onQuit: () => void
    onMinimize: () => void
  },
): void {
  const { configManager, processManager, logManager, portManager, workspaceManager, environmentManager, scannerRegistry } = managers

  // Set up LogManager sender for log:batch events
  logManager.setSender(sender)
  logManager.startFlushTimer()

  // Register each domain
  registerWorkspaceHandlers(workspaceManager)
  registerServiceHandlers(processManager, workspaceManager, sender)
  registerLogHandlers(logManager)
  registerEnvironmentHandlers(environmentManager)
  registerPortHandlers(portManager)
  registerSystemHandlers(scannerRegistry)
  registerAppHandlers(configManager, workspaceManager, callbacks.onQuit, callbacks.onMinimize)
}

// Re-export IPC_CHANNELS for convenience
export { IPC_CHANNELS }

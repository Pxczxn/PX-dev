// PX Dev — Port IPC Handlers

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { PortCheckSchema, PortOwnerSchema, PortKillSchema, PortWaitListeningSchema } from '@shared/schemas/ipc.schema'
import type { PortManager } from '../managers/PortManager'
import { validate } from './index'

export function registerPortHandlers(portManager: PortManager): void {
  // port:check
  ipcMain.handle(IPC_CHANNELS.PORT_CHECK, async (_event, input: unknown) => {
    const data = validate(PortCheckSchema, input)
    const available = await portManager.isAvailable(data.port)
    return { port: data.port, available }
  })

  // port:owner
  ipcMain.handle(IPC_CHANNELS.PORT_OWNER, async (_event, input: unknown) => {
    const data = validate(PortOwnerSchema, input)
    const owner = await portManager.getOwner(data.port)
    return owner
  })

  // port:kill
  ipcMain.handle(IPC_CHANNELS.PORT_KILL, async (_event, input: unknown) => {
    const data = validate(PortKillSchema, input)
    const success = await portManager.kill(data.pid)
    return { success }
  })

  // port:waitListening
  ipcMain.handle(IPC_CHANNELS.PORT_WAIT_LISTENING, async (_event, input: unknown) => {
    const data = validate(PortWaitListeningSchema, input)
    const listening = await portManager.waitUntilListening(data.port, data.timeoutMs)
    return { port: data.port, listening }
  })
}

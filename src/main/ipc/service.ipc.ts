// PX Dev — Service IPC Handlers (start/stop/restart/runtime/workspace ops)
//
// Phase 6 新增：接收 optional RuntimeEndpointRegistry，
// 进程状态进入终态（stopped / exited / failed）时清理对应服务的运行时端点快照。

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import {
  StartServiceSchema,
  StopServiceSchema,
  RestartServiceSchema,
  ForceKillServiceSchema,
  GetRuntimeSchema,
  StartWorkspaceSchema,
  StopWorkspaceSchema,
} from '@shared/schemas/ipc.schema'
import type { ProcessManager } from '../managers/ProcessManager'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import type { RuntimeEndpointRegistry } from '../discovery'
import { validate, IpcError } from './index'

/** 进入终态时清空运行时端点（Runtime 停止即删，永不残留） */
const TERMINAL_STATUSES = new Set(['stopped', 'exited', 'failed'])

export function registerServiceHandlers(
  pm: ProcessManager,
  wm: WorkspaceManager,
  sender: (channel: string, payload: unknown) => void,
  endpointRegistry?: RuntimeEndpointRegistry,
): void {
  // Set up runtime change callback → emit to renderer + Phase 6 清理端点
  pm.setRuntimeChangeCallback((serviceId, runtime) => {
    sender(IPC_CHANNELS.SERVICE_RUNTIME_CHANGED_EVENT, { serviceId, runtime })

    // Phase 6：进程终态时清空运行时端点快照
    if (endpointRegistry && TERMINAL_STATUSES.has(runtime.status)) {
      endpointRegistry.clear(serviceId)
    }
  })

  // service:start
  ipcMain.handle(IPC_CHANNELS.SERVICE_START, async (_event, input: unknown) => {
    const data = validate(StartServiceSchema, input)
    const service = wm.getService(data.serviceId)
    if (!service) {
      throw new IpcError('PROCESS_NOT_FOUND', `服务不存在: ${data.serviceId}`)
    }
    return pm.start(service)
  })

  // service:stop
  ipcMain.handle(IPC_CHANNELS.SERVICE_STOP, async (_event, input: unknown) => {
    const data = validate(StopServiceSchema, input)
    return pm.stop(data.serviceId)
  })

  // service:restart
  ipcMain.handle(IPC_CHANNELS.SERVICE_RESTART, async (_event, input: unknown) => {
    const data = validate(RestartServiceSchema, input)
    const service = wm.getService(data.serviceId)
    if (!service) {
      throw new IpcError('PROCESS_NOT_FOUND', `服务不存在: ${data.serviceId}`)
    }
    return pm.restart(service)
  })

  // service:forceKill
  ipcMain.handle(IPC_CHANNELS.SERVICE_FORCE_KILL, async (_event, input: unknown) => {
    const data = validate(ForceKillServiceSchema, input)
    await pm.forceKill(data.serviceId)
    return { success: true }
  })

  // service:runtime
  ipcMain.handle(IPC_CHANNELS.SERVICE_RUNTIME, async (_event, input: unknown) => {
    const data = validate(GetRuntimeSchema, input)
    if (data?.serviceId) {
      return pm.getRuntime(data.serviceId) ?? null
    }
    return pm.getAllRuntimes()
  })

  // service:startWorkspace
  ipcMain.handle(IPC_CHANNELS.SERVICE_START_WORKSPACE, async (_event, input: unknown) => {
    const data = validate(StartWorkspaceSchema, input)
    const services = wm.listServices(data.workspaceId)
    const enabledServices = services.filter((s) => s.enabled)
    const results: unknown[] = []

    const workspace = wm.getWorkspace(data.workspaceId)
    const startMode = workspace?.startMode ?? 'parallel'

    if (startMode === 'parallel') {
      // Start all in parallel
      const promises = enabledServices.map((s) => pm.start(s))
      const settled = await Promise.allSettled(promises)
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          results.push({ serviceId: enabledServices[i].id, error: result.reason.message })
        }
      }
    } else {
      // Sequential or dependency mode: start one by one
      for (const svc of enabledServices) {
        if (svc.startupDelay && svc.startupDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, svc.startupDelay))
        }
        try {
          const runtime = await pm.start(svc)
          results.push(runtime)
        } catch (err) {
          results.push({ serviceId: svc.id, error: (err as Error).message })
        }
      }
    }

    return results
  })

  // service:stopWorkspace
  ipcMain.handle(IPC_CHANNELS.SERVICE_STOP_WORKSPACE, async (_event, input: unknown) => {
    const data = validate(StopWorkspaceSchema, input)
    const services = wm.listServices(data.workspaceId)
    await pm.stopWorkspace(data.workspaceId, services)
    return { success: true }
  })

  // service:stopAll
  ipcMain.handle(IPC_CHANNELS.SERVICE_STOP_ALL, async () => {
    await pm.stopAll()
    return { success: true }
  })
}

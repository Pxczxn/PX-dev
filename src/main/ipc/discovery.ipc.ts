// PX Dev — Workspace Discovery IPC Handlers（Phase 3）
//
// 三个通道：
// - workspace:discover        扫描根目录 → WorkspaceDiscoveryResult
// - workspace:applyDiscovery  批量创建 Service（main 侧单次落盘）→ Service[]
// - system:detectProject      单目录轻量检测 → DiscoveredProject | null
//
// 出参一律经 Zod `.parse()` 净化后再跨 IPC 返回：
// schema 全部是纯数据字段，parse 结果天然满足 structured clone，
// 杜绝 FS handle / class instance / Proxy 泄漏到渲染层。

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { ERROR_CODES } from '@shared/constants/status'
import { ApplyDiscoverySchema, SystemDetectProjectSchema } from '@shared/schemas/ipc.schema'
import {
  DetectProjectResultSchema,
  WorkspaceDiscoveryRequestSchema,
  WorkspaceDiscoveryResultSchema,
} from '@shared/schemas/discovery.schema'
import { ServiceSchema } from '@shared/schemas/service.schema'
import { z } from 'zod'
import type { WorkspaceManager } from '../managers/WorkspaceManager'
import type { WorkspaceDiscoveryManager } from '../discovery'
import { DiscoveryError } from '../discovery'
import { logger } from '../utils/logger'
import { validate, IpcError } from './index'

/** Service[] 的出参净化 schema */
const ServiceListSchema = z.array(ServiceSchema)

/**
 * 把 DiscoveryError（不依赖 electron 的领域异常）转成带错误码的 IpcError。
 * 其余异常统一归为 INTERNAL_ERROR，并在主进程留痕。
 */
function toIpcError(err: unknown, context: string): IpcError {
  if (err instanceof DiscoveryError) {
    return new IpcError(err.code, err.message)
  }
  if (err instanceof IpcError) {
    return err
  }
  const reason = err instanceof Error ? err.message : String(err)
  logger.error(`${context} 失败: ${reason}`)
  return new IpcError(ERROR_CODES.INTERNAL_ERROR, `${context}失败: ${reason}`)
}

export function registerDiscoveryHandlers(
  discoveryManager: WorkspaceDiscoveryManager,
  workspaceManager: WorkspaceManager,
): void {
  // workspace:discover
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DISCOVER, async (_event, input: unknown) => {
    const data = validate(WorkspaceDiscoveryRequestSchema, input)
    try {
      const result = await discoveryManager.discover(data.rootPath, data.options)
      // 出参净化：strict schema 会剥离任何多余键
      return WorkspaceDiscoveryResultSchema.parse(result)
    } catch (err) {
      throw toIpcError(err, 'workspace:discover 扫描')
    }
  })

  // workspace:applyDiscovery
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY, async (_event, input: unknown) => {
    const data = validate(ApplyDiscoverySchema, input)
    try {
      const created = workspaceManager.applyDiscovery(data.workspaceId, data.services)
      return ServiceListSchema.parse(created)
    } catch (err) {
      throw toIpcError(err, 'workspace:applyDiscovery 批量添加服务')
    }
  })

  // system:detectProject —— 只看该目录自身（maxDepth=0 时 walker 不展开子目录）
  ipcMain.handle(IPC_CHANNELS.SYSTEM_DETECT_PROJECT, async (_event, input: unknown) => {
    const data = validate(SystemDetectProjectSchema, input)
    try {
      const result = await discoveryManager.discover(data.path, {
        maxDepth: 0,
        // 单目录检测由调用方自行决定是否采用，library 也要如实返回
        includeLibrary: true,
      })
      const self = result.projects.find((p) => p.relativePath === '.') ?? null
      return DetectProjectResultSchema.parse(self)
    } catch (err) {
      throw toIpcError(err, 'system:detectProject 检测目录')
    }
  })
}

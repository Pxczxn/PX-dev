// PX Dev — WorkspaceManager
// Workspace + Service CRUD with ConfigManager persistence

import { randomUUID } from 'crypto'
import type { Workspace, Service, AppConfig, ServiceDiscoveryMeta } from '@shared/types'
import { ConfigManager } from './ConfigManager'
import { ProcessManager } from './ProcessManager'
import { logger } from '../utils/logger'

// ============ Input Types (for create/update) ============
export interface CreateWorkspaceInput {
  name: string
  description?: string
  rootPath?: string
  color?: string
  icon?: string
  favorite?: boolean
  startMode?: 'parallel' | 'sequential' | 'dependency'
}

export interface UpdateWorkspaceInput {
  name?: string
  description?: string
  rootPath?: string
  color?: string
  icon?: string
  favorite?: boolean
  startMode?: 'parallel' | 'sequential' | 'dependency'
}

export interface CreateServiceInput {
  workspaceId: string
  name: string
  type: 'frontend' | 'node' | 'java' | 'generic'
  role: 'frontend' | 'backend'
  cwd: string
  command: string
  args?: string[]
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'custom'
  port?: number
  env?: Record<string, string>
  envFile?: string
  enabled?: boolean
  dependencies?: string[]
  startupDelay?: number
  autoOpenBrowser?: boolean
  openUrl?: string
  healthCheck?: {
    type: 'none' | 'port' | 'http'
    target?: string
    timeoutMs?: number
    intervalMs?: number
    retries?: number
  }
  shellMode?: boolean
  /** 发现元数据（可选）；仅批量添加发现结果时携带 */
  discovery?: ServiceDiscoveryMeta
}

export interface UpdateServiceInput extends Partial<CreateServiceInput> {
  id: string
}

export class WorkspaceManager {
  private configManager: ConfigManager
  private processManager: ProcessManager | null

  constructor(configManager: ConfigManager, processManager?: ProcessManager) {
    this.configManager = configManager
    this.processManager = processManager ?? null
  }

  /** Set ProcessManager (for stopping services before delete) */
  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm
  }

  // ============ Workspace CRUD ============

  listWorkspaces(): Workspace[] {
    return this.deepClone(this.configManager.get().workspaces)
  }

  getWorkspace(id: string): Workspace | undefined {
    const ws = this.configManager.get().workspaces.find((w) => w.id === id)
    return ws ? this.deepClone(ws) : undefined
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const now = new Date().toISOString()
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      rootPath: input.rootPath,
      color: input.color,
      icon: input.icon,
      favorite: input.favorite ?? false,
      startMode: input.startMode ?? 'parallel',
      createdAt: now,
      updatedAt: now,
    }

    const config = this.configManager.get()
    config.workspaces.push(workspace)
    this.configManager.save(config)

    logger.info(`Workspace created: ${workspace.name} (${workspace.id})`)
    return this.deepClone(workspace)
  }

  updateWorkspace(id: string, input: UpdateWorkspaceInput): Workspace {
    const config = this.configManager.get()
    const idx = config.workspaces.findIndex((w) => w.id === id)
    if (idx === -1) {
      throw new Error(`Workspace not found: ${id}`)
    }

    const updated: Workspace = {
      ...config.workspaces[idx],
      ...input,
      id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    }

    config.workspaces[idx] = updated
    this.configManager.save(config)

    logger.info(`Workspace updated: ${updated.name} (${id})`)
    return this.deepClone(updated)
  }

  deleteWorkspace(id: string): void {
    const config = this.configManager.get()

    // Cascade delete: stop and remove all services in this workspace
    const workspaceServices = config.services.filter((s) => s.workspaceId === id)
    for (const svc of workspaceServices) {
      // Stop running service first
      if (this.processManager) {
        this.processManager.stop(svc.id).catch((e) => {
          logger.warn(`Failed to stop service ${svc.name} during workspace delete: ${e.message}`)
        })
        this.processManager.removeService(svc.id)
      }
    }

    // Remove services
    config.services = config.services.filter((s) => s.workspaceId !== id)
    // Remove workspace
    config.workspaces = config.workspaces.filter((w) => w.id !== id)

    this.configManager.save(config)
    logger.info(`Workspace deleted: ${id} (cascade deleted ${workspaceServices.length} services)`)
  }

  // ============ Service CRUD ============

  listServices(workspaceId?: string): Service[] {
    const services = this.configManager.get().services
    const filtered = workspaceId ? services.filter((s) => s.workspaceId === workspaceId) : services
    return this.deepClone(filtered)
  }

  getService(id: string): Service | undefined {
    const svc = this.configManager.get().services.find((s) => s.id === id)
    return svc ? this.deepClone(svc) : undefined
  }

  createService(input: CreateServiceInput): Service {
    const service = this.buildService(input)

    const config = this.configManager.get()
    config.services.push(service)
    this.configManager.save(config)

    logger.info(`Service created: ${service.name} (${service.id})`)
    return this.deepClone(service)
  }

  /**
   * 批量创建 Service（Workspace Discovery 专用）。
   *
   * 与逐条 createService 的差异：
   * 1. **单次落盘** —— 所有 Service 构造完毕后只调用一次 configManager.save，避免 N 次原子写；
   * 2. 每条自动写入 discovery 元数据 `{ managed: true, lastDetectedAt, sourcePath }`（Phase 6 重扫比对预埋），
   *    渲染层传入的 discovery 只作为基底，managed / lastDetectedAt / sourcePath 由 main 侧强制校正；
   * 3. 每条的 workspaceId 一律以入参 workspaceId 为准，避免渲染层伪造跨工作区写入。
   */
  applyDiscovery(workspaceId: string, inputs: CreateServiceInput[]): Service[] {
    const config = this.configManager.get()
    const exists = config.workspaces.some((w) => w.id === workspaceId)
    if (!exists) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    const detectedAt = Date.now()
    const created: Service[] = []

    for (const input of inputs) {
      const service = this.buildService({
        ...input,
        workspaceId,
        discovery: {
          ...input.discovery,
          managed: true,
          lastDetectedAt: detectedAt,
          sourcePath: input.discovery?.sourcePath ?? input.cwd,
        },
      })
      created.push(service)
    }

    // 全部构造成功后再统一 push + 一次性落盘
    config.services.push(...created)
    this.configManager.save(config)

    logger.info(`Discovery applied: ${created.length} services created in workspace ${workspaceId}`)
    return this.deepClone(created)
  }

  updateService(id: string, input: Omit<UpdateServiceInput, 'id'>): Service {
    const config = this.configManager.get()
    const idx = config.services.findIndex((s) => s.id === id)
    if (idx === -1) {
      throw new Error(`Service not found: ${id}`)
    }

    const updated: Service = {
      ...config.services[idx],
      ...input,
      id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    }

    config.services[idx] = updated
    this.configManager.save(config)

    logger.info(`Service updated: ${updated.name} (${id})`)
    return this.deepClone(updated)
  }

  deleteService(id: string): void {
    // Stop running service first
    if (this.processManager) {
      this.processManager.stop(id).catch((e) => {
        logger.warn(`Failed to stop service ${id} during delete: ${e.message}`)
      })
      this.processManager.removeService(id)
    }

    const config = this.configManager.get()
    config.services = config.services.filter((s) => s.id !== id)
    this.configManager.save(config)

    logger.info(`Service deleted: ${id}`)
  }

  // ============ Settings ============

  getSettings(): AppConfig['settings'] {
    return this.deepClone(this.configManager.get().settings)
  }

  updateSettings(patch: Partial<AppConfig['settings']>): AppConfig['settings'] {
    const config = this.configManager.get()
    config.settings = { ...config.settings, ...patch }
    this.configManager.save(config)
    return this.deepClone(config.settings)
  }

  // ============ Private ============

  /** 由 CreateServiceInput 构造完整 Service（不落盘），createService / applyDiscovery 共用 */
  private buildService(input: CreateServiceInput): Service {
    const now = new Date().toISOString()
    return {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      type: input.type,
      role: input.role,
      cwd: input.cwd,
      command: input.command,
      args: input.args,
      packageManager: input.packageManager,
      port: input.port,
      env: input.env,
      envFile: input.envFile,
      enabled: input.enabled ?? true,
      dependencies: input.dependencies ?? [],
      startupDelay: input.startupDelay,
      autoOpenBrowser: input.autoOpenBrowser,
      openUrl: input.openUrl,
      healthCheck: input.healthCheck,
      shellMode: input.shellMode ?? false,
      discovery: input.discovery,
      createdAt: now,
      updatedAt: now,
    }
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T
  }
}

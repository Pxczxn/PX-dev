// PX Dev — ProcessManager
// spawn + process tree kill + state machine + log integration

import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { shell } from 'electron'
import treeKill from 'tree-kill'
import type {
  Service,
  ProcessRuntime,
  ProcessStatus,
  ManagedProcess,
  LogEntry,
} from '@shared/types'
import { VALID_TRANSITIONS, ERROR_CODES } from '@shared/constants/status'
import { LogManager } from './LogManager'
import type { PortManager } from './PortManager'
import { buildCommand, type BuiltCommand } from '../utils/command'
import { runHealthCheck } from '../utils/health'
import { logger } from '../utils/logger'

/** Custom error with code field for IPC error handling */
export class ProcessError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ProcessError'
  }
}

/**
 * 把 spawn 抛出的底层 errno 翻译成可操作的中文提示。
 *
 * 裸的 `spawn EINVAL` / `spawn ENOENT` 对用户毫无指导意义，
 * 这里针对最常见的三类失败给出明确的排查方向。
 *
 * @param err        spawn 抛出的错误（可能带 errno code）
 * @param executable 实际传给 spawn 的可执行文件
 * @param shell      本次是否启用了 shell
 */
export function describeSpawnError(
  err: NodeJS.ErrnoException,
  executable: string,
  shell: boolean,
): string {
  switch (err.code) {
    case 'ENOENT':
      return `找不到命令 "${executable}"：请确认它已安装且在 PATH 中，或在服务配置里填写完整路径`
    case 'EINVAL':
      // Windows 下 .cmd/.bat 必须走 shell（Node CVE-2024-27980 缓解措施）
      return (
        `启动命令失败（EINVAL）: "${executable}" 无法以 shell=${shell} 的方式启动。` +
        'Windows 上的 .cmd / .bat 脚本必须通过 shell 启动，请在服务配置中开启「Shell 模式」后重试'
      )
    case 'EACCES':
      return `没有执行权限: "${executable}"，请检查文件权限或以管理员身份运行`
    default:
      return `启动命令失败: ${err.message}`
  }
}

/** Callback type for runtime change notifications */
export type RuntimeChangeCallback = (serviceId: string, runtime: ProcessRuntime) => void

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map()
  private logManager: LogManager
  private portManager: PortManager | null
  private onRuntimeChange: RuntimeChangeCallback | null = null

  constructor(logManager: LogManager, portManager?: PortManager) {
    this.logManager = logManager
    this.portManager = portManager ?? null
  }

  /** Set callback for runtime state change notifications (→ IPC event) */
  setRuntimeChangeCallback(cb: RuntimeChangeCallback): void {
    this.onRuntimeChange = cb
  }

  /** Set the PortManager (can be injected later if needed) */
  setPortManager(pm: PortManager): void {
    this.portManager = pm
  }

  /**
   * Start a service process.
   * Flow: validate cwd → port pre-check → spawn → status=starting → health check → status=running
   */
  async start(service: Service): Promise<ProcessRuntime> {
    // Check if already running
    const existing = this.processes.get(service.id)
    if (existing && (existing.runtime.status === 'running' || existing.runtime.status === 'starting')) {
      throw new ProcessError(
        ERROR_CODES.PROCESS_RUNNING,
        `服务 ${service.name} 已在运行中`,
      )
    }

    // 1. Validate cwd
    // 配置损坏或用户清空时 cwd 可能是 undefined/空串，resolve() 会直接抛 TypeError，
    // 因此先做显式校验，转成带错误码的 ProcessError。
    const rawCwd = typeof service.cwd === 'string' ? service.cwd.trim() : ''
    if (rawCwd === '') {
      throw new ProcessError(
        ERROR_CODES.CWD_NOT_FOUND,
        `服务 ${service.name} 未配置工作目录`,
      )
    }
    const cwd = resolve(rawCwd)
    if (!existsSync(cwd)) {
      throw new ProcessError(
        ERROR_CODES.CWD_NOT_FOUND,
        `工作目录不存在: ${service.cwd}`,
      )
    }

    // 2. Port pre-check (if port configured)
    if (service.port && this.portManager) {
      const available = await this.portManager.isAvailable(service.port)
      if (!available) {
        const owner = await this.portManager.getOwner(service.port)
        const ownerInfo = owner ? `PID ${owner.pid} (${owner.name})` : '未知进程'
        throw new ProcessError(
          ERROR_CODES.PORT_CONFLICT,
          `端口 ${service.port} 已被 ${ownerInfo} 占用`,
        )
      }
    }

    // 3. Build spawn options
    // buildCommand 会在命令为空时抛普通 Error，统一转成带错误码的 ProcessError，
    // 避免 IPC 层拿到一个没有 code 的裸错误。
    let built: BuiltCommand
    try {
      built = buildCommand(service)
    } catch (err) {
      throw new ProcessError(ERROR_CODES.VALIDATION_ERROR, (err as Error).message)
    }
    const { executable, args, options } = built
    options.cwd = cwd

    // 4. Initialize runtime + managed process
    const runtime: ProcessRuntime = {
      serviceId: service.id,
      status: 'stopped',
      ready: false,
      startedAt: Date.now(),
    }
    const managed: ManagedProcess = {
      child: null as unknown as ChildProcess,
      runtime,
    }
    this.processes.set(service.id, managed)

    // Transition to starting
    this.transition(service.id, 'starting')

    // 5. Spawn
    // 记录完整 spawn 参数：EINVAL / ENOENT 这类错误没有上下文时极难定位
    logger.info(
      `Spawning ${service.name}: executable=${executable}, ` +
        `args=${JSON.stringify(args)}, cwd=${options.cwd}, shell=${options.shell}`,
    )
    try {
      const child = spawn(executable, args, options)
      managed.child = child
      managed.runtime.pid = child.pid ?? undefined

      // 6. Log integration
      this.logManager.subscribe(service.id)
      this.attachLogListeners(service.id, child)

      // 7. Error event
      child.on('error', (err) => {
        logger.error(`Process error for ${service.name}: ${err.message}`)
        managed.runtime.error = err.message
        this.transition(service.id, 'failed')
      })

      // 8. Exit event
      child.on('exit', (code, signal) => {
        logger.info(`Process exited: ${service.name}, code=${code}, signal=${signal}`)
        managed.runtime.exitCode = code
        if (managed.runtime.status === 'stopping') {
          this.transition(service.id, 'stopped')
        } else if (code === 0) {
          this.transition(service.id, 'exited')
        } else {
          this.transition(service.id, 'failed')
        }
      })
    } catch (err) {
      // spawn 对 EINVAL / EACCES 等错误是**同步抛出**的（只有 ENOENT 等少数会走 error 事件），
      // 这里翻译成可操作的中文提示，并保留原始 errno 到日志便于排查。
      const errno = err as NodeJS.ErrnoException
      const detail = describeSpawnError(errno, executable, options.shell)
      logger.error(`Spawn failed for ${service.name} [${errno.code ?? 'UNKNOWN'}]: ${errno.message}`)
      managed.runtime.error = detail
      this.transition(service.id, 'failed')
      throw new ProcessError(ERROR_CODES.COMMAND_NOT_FOUND, detail)
    }

    // 9. Health check → running
    if (service.healthCheck?.type && service.healthCheck.type !== 'none') {
      const healthy = await runHealthCheck(service)
      if (healthy && managed.runtime.status === 'starting') {
        this.transition(service.id, 'running')
        // 10. Auto open browser
        if (service.autoOpenBrowser && service.openUrl) {
          shell.openExternal(service.openUrl).catch((e) => {
            logger.warn(`Failed to open browser: ${e.message}`)
          })
        }
      } else if (!healthy && managed.runtime.status === 'starting') {
        // Health check failed but process is still alive → mark failed
        logger.warn(`Health check failed for ${service.name}, but process may still be running`)
        // Don't transition to failed here — process is still alive
        // The caller can decide to stop it
      }
    } else {
      // No health check: spawn success = running
      this.transition(service.id, 'running')
      if (service.autoOpenBrowser && service.openUrl) {
        shell.openExternal(service.openUrl).catch((e) => {
          logger.warn(`Failed to open browser: ${e.message}`)
        })
      }
    }

    return { ...managed.runtime }
  }

  /** Attach stdout/stderr listeners to push logs to LogManager */
  private attachLogListeners(serviceId: string, child: ChildProcess): void {
    child.stdout?.on('data', (chunk: Buffer) => {
      const entry: LogEntry = {
        serviceId,
        timestamp: Date.now(),
        stream: 'stdout',
        text: chunk.toString(),
      }
      this.logManager.append(serviceId, entry)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const entry: LogEntry = {
        serviceId,
        timestamp: Date.now(),
        stream: 'stderr',
        text: chunk.toString(),
      }
      this.logManager.append(serviceId, entry)
    })
  }

  /**
   * Stop a service process using tree-kill (SIGTERM, fallback SIGKILL).
   */
  async stop(serviceId: string): Promise<ProcessRuntime> {
    const managed = this.processes.get(serviceId)
    if (!managed || !managed.child || !managed.child.pid) {
      return {
        serviceId,
        status: 'stopped',
        ready: false,
      }
    }

    const currentStatus = managed.runtime.status
    if (currentStatus === 'stopped' || currentStatus === 'exited' || currentStatus === 'failed') {
      return { ...managed.runtime }
    }

    this.transition(serviceId, 'stopping')

    const pid = managed.child.pid

    return new Promise<ProcessRuntime>((resolve) => {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) {
          logger.warn(`tree-kill SIGTERM failed for PID ${pid}, trying SIGKILL: ${err.message}`)
          treeKill(pid, 'SIGKILL', () => {
            this.transition(serviceId, 'stopped')
            this.logManager.unsubscribe(serviceId)
            resolve({ ...managed.runtime })
          })
        } else {
          this.transition(serviceId, 'stopped')
          this.logManager.unsubscribe(serviceId)
          resolve({ ...managed.runtime })
        }
      })
    })
  }

  /** Restart = stop + start */
  async restart(service: Service): Promise<ProcessRuntime> {
    await this.stop(service.id)
    // Small delay to ensure port is released
    await this.sleep(200)
    return this.start(service)
  }

  /** Force kill with SIGKILL */
  async forceKill(serviceId: string): Promise<void> {
    const managed = this.processes.get(serviceId)
    if (!managed || !managed.child || !managed.child.pid) {
      return
    }

    const pid = managed.child.pid

    return new Promise<void>((resolve) => {
      treeKill(pid, 'SIGKILL', () => {
        this.transition(serviceId, 'stopped')
        this.logManager.unsubscribe(serviceId)
        resolve()
      })
    })
  }

  /** Stop all services in a workspace */
  async stopWorkspace(workspaceId: string, services: Service[]): Promise<void> {
    const workspaceServices = services.filter((s) => s.workspaceId === workspaceId)
    await Promise.all(workspaceServices.map((s) => this.stop(s.id)))
  }

  /** Stop all running services */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<ProcessRuntime>[] = []
    for (const [serviceId, managed] of this.processes) {
      if (
        managed.runtime.status === 'running' ||
        managed.runtime.status === 'starting' ||
        managed.runtime.status === 'stopping'
      ) {
        stopPromises.push(this.stop(serviceId))
      }
    }
    await Promise.all(stopPromises)
  }

  /** Get runtime state for a single service */
  getRuntime(serviceId: string): ProcessRuntime | undefined {
    const managed = this.processes.get(serviceId)
    if (!managed) {
      return undefined
    }
    return { ...managed.runtime }
  }

  /** Get runtime states for all services */
  getAllRuntimes(): ProcessRuntime[] {
    const result: ProcessRuntime[] = []
    for (const managed of this.processes.values()) {
      result.push({ ...managed.runtime })
    }
    return result
  }

  /** Mark all previously-running processes as 'unknown' (app restart scenario) */
  markAllAsUnknown(): void {
    for (const [serviceId, managed] of this.processes) {
      if (
        managed.runtime.status === 'running' ||
        managed.runtime.status === 'starting'
      ) {
        // Process is likely dead after app restart
        managed.runtime.status = 'unknown'
        managed.runtime.ready = false
        managed.child = null as unknown as ChildProcess
        this.emitRuntimeChanged(serviceId, managed.runtime)
      }
    }
  }

  /** Remove a service from tracking (called when service is deleted) */
  removeService(serviceId: string): void {
    this.processes.delete(serviceId)
    this.logManager.removeService(serviceId)
  }

  // ============ State Machine ============

  /**
   * Transition a service to a new status.
   * Validates against VALID_TRANSITIONS map.
   * Invalid transitions are logged as warnings but don't throw (process events may arrive out of order).
   */
  private transition(serviceId: string, newStatus: ProcessStatus): void {
    const managed = this.processes.get(serviceId)
    if (!managed) {
      logger.warn(`transition: no process found for ${serviceId}`)
      return
    }

    const oldStatus = managed.runtime.status
    const allowed = VALID_TRANSITIONS[oldStatus]

    if (!allowed.includes(newStatus)) {
      logger.warn(`Invalid transition: ${oldStatus} → ${newStatus} for ${serviceId}`)
      return
    }

    managed.runtime.status = newStatus

    // Side effects
    if (newStatus === 'running') {
      managed.runtime.ready = true
    }
    if (newStatus === 'stopped' || newStatus === 'exited' || newStatus === 'failed') {
      managed.runtime.ready = false
      managed.runtime.stoppedAt = Date.now()
    }

    this.emitRuntimeChanged(serviceId, managed.runtime)
  }

  /** Emit runtime change event to callback (→ IPC event → renderer) */
  private emitRuntimeChanged(serviceId: string, runtime: ProcessRuntime): void {
    if (this.onRuntimeChange) {
      this.onRuntimeChange(serviceId, { ...runtime })
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

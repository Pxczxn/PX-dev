// PX Dev — 运行时端点注册表（Phase 5）
//
// 职责：订阅 LogManager 的日志批次 → 交给 RuntimeEndpointDetector 解析 →
//       按服务累积去重 → 计算 Configured/Runtime 冲突 → 节流 500ms 推送 `runtime:endpoints`。
//
// 红线约束：
// 1. **纯内存**：只有一个 Map，绝不落盘、绝不碰 ConfigManager、绝不写 `Service.port`；
//    Configured / Detected / Runtime 三层严格分离，Runtime 只做展示与提示。
// 2. **不实现第二套排序/去重**：全部委托 `utils/endpointPriority`（经 Detector 间接复用）。
// 3. **不改 ProcessManager**：进程停止的清理由 `service.ipc.ts` 已有的
//    `SERVICE_RUNTIME_CHANGED_EVENT` 调用点旁路调用 `clear(serviceId)`。
// 4. 监听器必须**同步 + 快速**，且自身异常绝不能影响 LogManager 的日志推送
//    （LogManager 侧已有 try/catch 隔离，这里再做一层内部兜底）。

import type {
  DetectedEndpoint,
  LogEntry,
  RuntimeEndpointSnapshot,
  RuntimePortConflict,
} from '@shared/types'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import {
  RuntimeEndpointSnapshotSchema,
  RuntimeEndpointsPayloadSchema,
} from '@shared/schemas/discovery.schema'
import {
  MAX_ENDPOINTS_PER_PARSE,
  MAX_LINES_PER_PARSE,
  parseRuntimeEndpoints,
  pickPrimaryEndpoint,
  pickPrimaryUrl,
} from '../detectors/RuntimeEndpointDetector'
import { normalizeEndpoints } from './utils/endpointPriority'
import { logger } from '../utils/logger'

// ============ 依赖的最小接口（结构化契约，避免与具体类强耦合） ============

/** 事件发送函数，与 LogManager / ipc 层的 sender 同型 */
export type RuntimeEndpointSender = (channel: string, payload: unknown) => void

/** LogManager 派发给监听器的批次通知（与 LogManager.LogBatchNotice 结构一致） */
export interface RuntimeLogBatch {
  serviceId: string
  entries: Array<Pick<LogEntry, 'text'>>
}

/** 只依赖「能加/删批次监听器」这一能力，便于测试注入假实现 */
export interface BatchListenerHost {
  addBatchListener(listener: (notice: RuntimeLogBatch) => void): () => void
  removeBatchListener(listener: (notice: RuntimeLogBatch) => void): void
}

/** Configured 端口解析器：由接线层注入（通常是 `wm.getService(id)?.port`） */
export type ConfiguredPortResolver = (serviceId: string) => number | undefined

export interface RuntimeEndpointRegistryOptions {
  /** 变更推送节流窗口，默认 500ms */
  throttleMs?: number
  /** 单个服务最多保留的端点数，默认 10 */
  maxEndpointsPerService?: number
  /** 单次批次最多处理的日志行数，默认 200 */
  maxLinesPerBatch?: number
}

/** 默认节流窗口（毫秒） */
export const DEFAULT_RUNTIME_ENDPOINT_THROTTLE_MS = 500

// ============ 内部可变状态 ============

interface MutableSnapshot {
  serviceId: string
  endpoints: DetectedEndpoint[]
  primaryUrl?: string
  runtimePort?: number
  conflict?: RuntimePortConflict
  updatedAt: number
  /** 上一次推送出去的内容指纹，用于「无实质变化不推送」 */
  signature: string
}

export class RuntimeEndpointRegistry {
  /** serviceId → 运行时端点快照（纯内存，进程停止即删） */
  private readonly snapshots: Map<string, MutableSnapshot> = new Map()

  /** serviceId → 节流窗口定时器；存在即表示窗口开启中，本窗口内的变更全部合并 */
  private readonly throttleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  private sender: RuntimeEndpointSender | null = null
  private configuredPortResolver: ConfiguredPortResolver | null = null
  private detachListener: (() => void) | null = null

  private readonly throttleMs: number
  private readonly maxEndpointsPerService: number
  private readonly maxLinesPerBatch: number

  /** 绑定一次，保证 add/removeBatchListener 拿到的是同一个函数引用 */
  private readonly onBatch = (notice: RuntimeLogBatch): void => {
    this.ingestBatch(notice.serviceId, notice.entries)
  }

  constructor(options: RuntimeEndpointRegistryOptions = {}) {
    this.throttleMs = options.throttleMs ?? DEFAULT_RUNTIME_ENDPOINT_THROTTLE_MS
    this.maxEndpointsPerService = options.maxEndpointsPerService ?? MAX_ENDPOINTS_PER_PARSE
    this.maxLinesPerBatch = options.maxLinesPerBatch ?? MAX_LINES_PER_PARSE
  }

  // ============ 接线 ============

  /** 设置事件发送函数（`runtime:endpoints` 的出口） */
  setSender(sender: RuntimeEndpointSender): void {
    this.sender = sender
  }

  /**
   * 注入 Configured 端口来源。
   * 只读取，绝不回写——Runtime 永不静默覆盖 Configured。
   */
  setConfiguredPortResolver(resolver: ConfiguredPortResolver): void {
    this.configuredPortResolver = resolver
  }

  /**
   * 订阅 LogManager 的批次派发。
   * @returns 解绑函数；重复 attach 会先解绑上一次，避免重复订阅泄漏
   */
  attach(host: BatchListenerHost, sender?: RuntimeEndpointSender): () => void {
    this.detach()
    if (sender) this.setSender(sender)
    this.detachListener = host.addBatchListener(this.onBatch)
    return () => this.detach()
  }

  /** 解除对 LogManager 的订阅（幂等） */
  detach(): void {
    if (this.detachListener) {
      try {
        this.detachListener()
      } catch (err) {
        logger.error(`RuntimeEndpointRegistry detach 失败: ${(err as Error).message}`)
      }
      this.detachListener = null
    }
  }

  // ============ 采集 ============

  /**
   * 摄入一批日志行并更新快照。
   * 必须同步且快速：本方法运行在 LogManager.flush() 的调用栈上。
   */
  ingestBatch(serviceId: string, entries: Array<Pick<LogEntry, 'text'>>): void {
    if (!serviceId || !Array.isArray(entries) || entries.length === 0) return

    const limit = Math.min(entries.length, this.maxLinesPerBatch)
    let text = ''
    for (let i = 0; i < limit; i++) {
      const line = entries[i]?.text
      if (typeof line !== 'string' || line.length === 0) continue
      text += text.length === 0 ? line : `\n${line}`
    }
    if (text.length === 0) return

    const found = parseRuntimeEndpoints(text, {
      maxLines: this.maxLinesPerBatch,
      maxEndpoints: this.maxEndpointsPerService,
    })
    if (found.length === 0) return

    this.mergeEndpoints(serviceId, found)
  }

  /** 合并新端点到既有快照；有实质变化才安排推送 */
  private mergeEndpoints(serviceId: string, incoming: DetectedEndpoint[]): void {
    const existing = this.snapshots.get(serviceId)
    // 新端点在前：同 (type,host,port) 冲突时 dedupeEndpoints 按 confidence 取优，
    // 顺序只影响并列情况，让「最新观测」胜出更符合运行时语义。
    const merged = normalizeEndpoints([...incoming, ...(existing?.endpoints ?? [])]).slice(
      0,
      this.maxEndpointsPerService,
    )

    const primary = pickPrimaryEndpoint(merged)
    const primaryUrl = pickPrimaryUrl(merged)
    const runtimePort = primary?.port
    const conflict = this.computeConflict(serviceId, runtimePort)

    const signature = buildSignature(merged, primaryUrl, runtimePort, conflict)
    if (existing && existing.signature === signature) {
      // 重复日志行 / 无实质变化：不刷新时间戳、不推送
      return
    }

    this.snapshots.set(serviceId, {
      serviceId,
      endpoints: merged,
      ...(primaryUrl === undefined ? {} : { primaryUrl }),
      ...(runtimePort === undefined ? {} : { runtimePort }),
      ...(conflict === undefined ? {} : { conflict }),
      updatedAt: Date.now(),
      signature,
    })

    this.scheduleEmit(serviceId)
  }

  /**
   * 计算 Configured / Runtime 端口冲突。
   * 仅当两者都存在且不相等时才产生提示；任一缺失都视为「无冲突」（宁可不提示，绝不误报）。
   */
  private computeConflict(
    serviceId: string,
    runtimePort: number | undefined,
  ): RuntimePortConflict | undefined {
    if (runtimePort === undefined) return undefined

    let configuredPort: number | undefined
    try {
      configuredPort = this.configuredPortResolver?.(serviceId)
    } catch (err) {
      logger.error(`读取配置端口失败(${serviceId}): ${(err as Error).message}`)
      return undefined
    }

    if (typeof configuredPort !== 'number' || !Number.isInteger(configuredPort)) return undefined
    if (configuredPort === runtimePort) return undefined

    return {
      configuredPort,
      runtimePort,
      message: `配置端口 ${configuredPort}，实际运行在 ${runtimePort}`,
    }
  }

  // ============ 查询 ============

  /** 取单个服务的快照（纯数据副本，可直接跨 IPC） */
  getSnapshot(serviceId: string): RuntimeEndpointSnapshot | null {
    const snapshot = this.snapshots.get(serviceId)
    return snapshot ? toPlainSnapshot(snapshot) : null
  }

  /** 取全部快照（`workspace:runtimeEndpoints` 的数据源） */
  getAllSnapshots(): RuntimeEndpointSnapshot[] {
    return [...this.snapshots.values()].map(toPlainSnapshot)
  }

  /** 当前已记录端点的服务数（测试 / 诊断用） */
  size(): number {
    return this.snapshots.size
  }

  // ============ 清理 ============

  /**
   * 清空某个服务的运行时端点，并**立即**推送 `runtime: null`。
   *
   * 由 `service.ipc.ts` 在进程进入 starting / stopped / exited / failed 时旁路调用。
   * 生命周期事件是离散的、不会洪水，因此绕过节流以获得即时反馈。
   */
  clear(serviceId: string): void {
    if (!serviceId) return
    this.cancelTimer(serviceId)
    const had = this.snapshots.delete(serviceId)
    if (!had) return
    this.emit(serviceId, null)
  }

  /** 清空全部服务（不推送事件，仅用于关闭 / 重置） */
  clearAll(): void {
    for (const timer of this.throttleTimers.values()) {
      clearTimeout(timer)
    }
    this.throttleTimers.clear()
    this.snapshots.clear()
  }

  /** 释放全部资源：解绑监听 + 清定时器 + 清数据 */
  dispose(): void {
    this.detach()
    this.clearAll()
    this.sender = null
  }

  // ============ 节流推送 ============

  /**
   * 尾沿节流：首次变更开启 500ms 窗口，窗口内的所有变更合并为一次推送。
   * 持续产生变更时仍会每 500ms 推送一次（throttle 而非 debounce，不会饿死）。
   */
  private scheduleEmit(serviceId: string): void {
    if (this.throttleTimers.has(serviceId)) return

    const timer = setTimeout(() => {
      this.throttleTimers.delete(serviceId)
      const snapshot = this.snapshots.get(serviceId)
      this.emit(serviceId, snapshot ? toPlainSnapshot(snapshot) : null)
    }, this.throttleMs)

    // 不阻塞主进程退出（Node 定时器；fake timers 下可能没有 unref）
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
    this.throttleTimers.set(serviceId, timer)
  }

  private cancelTimer(serviceId: string): void {
    const timer = this.throttleTimers.get(serviceId)
    if (timer) {
      clearTimeout(timer)
      this.throttleTimers.delete(serviceId)
    }
  }

  /**
   * 推送 `runtime:endpoints`。
   * 出参经 `.strict()` schema `.parse()` 消毒，保证跨 IPC 的是纯数据。
   * 任何异常都在此吞掉——事件推送失败绝不能反向影响日志链路。
   */
  private emit(serviceId: string, runtime: RuntimeEndpointSnapshot | null): void {
    if (!this.sender) return
    try {
      const payload = RuntimeEndpointsPayloadSchema.parse({ serviceId, runtime })
      this.sender(IPC_CHANNELS.RUNTIME_ENDPOINTS_EVENT, payload)
    } catch (err) {
      logger.error(`推送 runtime:endpoints 失败(${serviceId}): ${(err as Error).message}`)
    }
  }
}

// ============ 纯函数辅助 ============

/** 内部可变快照 → 对外纯数据快照（剥离 signature 等内部字段） */
function toPlainSnapshot(snapshot: MutableSnapshot): RuntimeEndpointSnapshot {
  const plain: RuntimeEndpointSnapshot = {
    serviceId: snapshot.serviceId,
    endpoints: snapshot.endpoints.map((e) => ({ ...e })),
    updatedAt: snapshot.updatedAt,
  }
  if (snapshot.primaryUrl !== undefined) plain.primaryUrl = snapshot.primaryUrl
  if (snapshot.runtimePort !== undefined) plain.runtimePort = snapshot.runtimePort
  if (snapshot.conflict !== undefined) plain.conflict = { ...snapshot.conflict }
  // strict schema 再净化一次，杜绝任何多余键泄漏到渲染层
  return RuntimeEndpointSnapshotSchema.parse(plain)
}

/** 内容指纹：只包含会影响 UI 的字段，用于「无实质变化不推送」 */
function buildSignature(
  endpoints: DetectedEndpoint[],
  primaryUrl: string | undefined,
  runtimePort: number | undefined,
  conflict: RuntimePortConflict | undefined,
): string {
  const parts = endpoints.map(
    (e) => `${e.type}|${e.host ?? ''}|${e.port ?? ''}|${e.url ?? ''}|${e.confidence}`,
  )
  return `${parts.join('#')}::${primaryUrl ?? ''}::${runtimePort ?? ''}::${conflict?.message ?? ''}`
}

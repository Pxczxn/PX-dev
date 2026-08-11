// PX Dev — LogManager
// Per-service Ring Buffer + 80ms batched flush via webContents.send

import type { LogEntry } from '@shared/types'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { logger } from '../utils/logger'

/** Type for the sender function that pushes events to renderer */
export type LogBatchSender = (channel: string, payload: unknown) => void

/**
 * 一次 flush 中派发给「批次监听器」的通知（Phase 5 新增）。
 * 形状与 `LOG_BATCH_EVENT` 的 payload 一致，便于监听器直接复用。
 *
 * ⚠️ `entries` 与推送给渲染层的是同一个数组引用，监听器必须**只读**。
 */
export interface LogBatchNotice {
  serviceId: string
  entries: LogEntry[]
}

/**
 * 批次监听器（Phase 5：RuntimeEndpointRegistry 的接入点）。
 * 必须是**同步 + 快速**的：它运行在 80ms flush 定时器的调用栈上。
 */
export type LogBatchListener = (notice: LogBatchNotice) => void

interface ServiceBuffer {
  entries: LogEntry[]
  /** Pending entries not yet flushed */
  pending: LogEntry[]
}

export class LogManager {
  private buffers: Map<string, ServiceBuffer> = new Map()
  private subscribers: Set<string> = new Set()
  private maxLines: number
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushIntervalMs: number = 80
  private sender: LogBatchSender | null = null
  /** Phase 5 追加：批次监听器集合（不影响既有推送逻辑） */
  private batchListeners: Set<LogBatchListener> = new Set()

  constructor(maxLines = 5000) {
    this.maxLines = maxLines
  }

  /** Set the sender function for pushing log:batch events to renderer */
  setSender(sender: LogBatchSender): void {
    this.sender = sender
  }

  /** Start the 80ms flush timer */
  startFlushTimer(): void {
    if (this.flushTimer) return
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs)
    logger.debug('LogManager flush timer started (80ms)')
  }

  /** Stop the flush timer */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
      logger.debug('LogManager flush timer stopped')
    }
  }

  /** Subscribe to log updates for a service */
  subscribe(serviceId: string): void {
    this.subscribers.add(serviceId)
    logger.debug(`LogManager subscribed: ${serviceId}`)
  }

  /** Unsubscribe from log updates for a service */
  unsubscribe(serviceId: string): void {
    this.subscribers.delete(serviceId)
    logger.debug(`LogManager unsubscribed: ${serviceId}`)
  }

  /** Append a log entry to the service's ring buffer */
  append(serviceId: string, entry: LogEntry): void {
    let buf = this.buffers.get(serviceId)
    if (!buf) {
      buf = { entries: [], pending: [] }
      this.buffers.set(serviceId, buf)
    }

    // Add to ring buffer
    buf.entries.push(entry)
    // Trim if exceeds max
    if (buf.entries.length > this.maxLines) {
      buf.entries.splice(0, buf.entries.length - this.maxLines)
    }

    // Add to pending (for batch flush)
    buf.pending.push(entry)
  }

  /** Clear the ring buffer for a service */
  clear(serviceId: string): void {
    const buf = this.buffers.get(serviceId)
    if (buf) {
      buf.entries = []
      buf.pending = []
    }
  }

  /** Get history entries for a service (optionally limited) */
  getHistory(serviceId: string, limit?: number): LogEntry[] {
    const buf = this.buffers.get(serviceId)
    if (!buf) return []

    if (limit && limit > 0) {
      const start = Math.max(0, buf.entries.length - limit)
      return buf.entries.slice(start)
    }
    return [...buf.entries]
  }

  /** Export logs as plain text (for file save) */
  export(serviceId: string): string {
    const entries = this.getHistory(serviceId)
    return entries
      .map((e) => {
        const time = new Date(e.timestamp).toISOString()
        const streamTag = e.stream === 'stderr' ? '[ERR]' : '[OUT]'
        return `[${time}] ${streamTag} ${e.text}`.trimEnd()
      })
      .join('\n')
  }

  /**
   * 注册批次监听器（Phase 5 追加）。
   *
   * 监听器在 `flush()` 末尾、**日志已推送给渲染层之后**被同步调用，
   * 每个监听器独立 try/catch，抛错既不影响日志推送也不影响其他监听器。
   *
   * @returns 取消订阅函数（等价于 `removeBatchListener(listener)`）
   */
  addBatchListener(listener: LogBatchListener): () => void {
    this.batchListeners.add(listener)
    return () => this.removeBatchListener(listener)
  }

  /** 移除批次监听器（幂等） */
  removeBatchListener(listener: LogBatchListener): void {
    this.batchListeners.delete(listener)
  }

  /** 当前批次监听器数量（诊断 / 测试用） */
  getBatchListenerCount(): number {
    return this.batchListeners.size
  }

  /** Flush pending entries to all subscribers via sender */
  private flush(): void {
    if (!this.sender) return

    // Phase 5：记录本轮实际推送出去的批次，供 flush 末尾派发给监听器
    const dispatched: LogBatchNotice[] = []

    for (const serviceId of this.subscribers) {
      const buf = this.buffers.get(serviceId)
      if (!buf || buf.pending.length === 0) continue

      const entries = [...buf.pending]
      buf.pending = []

      this.sender(IPC_CHANNELS.LOG_BATCH_EVENT, {
        serviceId,
        entries,
      })

      dispatched.push({ serviceId, entries })
    }

    // 日志推送已全部完成，此后监听器无论怎么炸都影响不到渲染层
    this.notifyBatchListeners(dispatched)
  }

  /**
   * 把本轮批次同步派发给所有监听器。
   * 逐个 try/catch 隔离：任一监听器抛错都被吞掉并记录，后续监听器照常执行。
   */
  private notifyBatchListeners(batches: LogBatchNotice[]): void {
    if (this.batchListeners.size === 0 || batches.length === 0) return

    // 快照一份，避免监听器在回调里增删集合导致迭代异常
    const listeners = [...this.batchListeners]
    for (const notice of batches) {
      for (const listener of listeners) {
        try {
          listener(notice)
        } catch (err) {
          logger.error(
            `LogManager batch listener failed (${notice.serviceId}): ${(err as Error).message}`,
          )
        }
      }
    }
  }

  /** Remove all data for a service (called when service is deleted) */
  removeService(serviceId: string): void {
    this.buffers.delete(serviceId)
    this.subscribers.delete(serviceId)
  }

  /** Get all subscribed service IDs */
  getSubscribers(): string[] {
    return Array.from(this.subscribers)
  }

  /** Update max lines (applies to new entries) */
  setMaxLines(max: number): void {
    this.maxLines = max
    // Trim existing buffers
    for (const buf of this.buffers.values()) {
      if (buf.entries.length > max) {
        buf.entries.splice(0, buf.entries.length - max)
      }
    }
  }
}

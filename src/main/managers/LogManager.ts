// PX Dev — LogManager
// Per-service Ring Buffer + 80ms batched flush via webContents.send

import type { LogEntry } from '@shared/types'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import { logger } from '../utils/logger'

/** Type for the sender function that pushes events to renderer */
export type LogBatchSender = (channel: string, payload: unknown) => void

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

  /** Flush pending entries to all subscribers via sender */
  private flush(): void {
    if (!this.sender) return

    for (const serviceId of this.subscribers) {
      const buf = this.buffers.get(serviceId)
      if (!buf || buf.pending.length === 0) continue

      const entries = [...buf.pending]
      buf.pending = []

      this.sender(IPC_CHANNELS.LOG_BATCH_EVENT, {
        serviceId,
        entries,
      })
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

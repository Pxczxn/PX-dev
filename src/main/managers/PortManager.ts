// PX Dev — PortManager
// TCP port availability check + wait until listening + port owner identification

import net from 'net'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PortOwner } from '@shared/types'
import { logger } from '../utils/logger'

const execFileAsync = promisify(execFile)

export class PortManager {
  /**
   * Check if a port is available (not in use).
   * Uses net.Socket to attempt a TCP connection — if connection fails, port is free.
   */
  async isAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      let resolved = false

      const done = (result: boolean) => {
        if (resolved) return
        resolved = true
        socket.destroy()
        resolve(result)
      }

      socket.setTimeout(1000)
      socket.once('connect', () => {
        // Connection succeeded → port is in use
        done(false)
      })
      socket.once('error', () => {
        // Connection failed → port is free
        done(true)
      })
      socket.once('timeout', () => {
        // Timeout → assume free
        done(true)
      })

      socket.connect(port, '127.0.0.1')
    })
  }

  /**
   * Wait until a port is listening (TCP connect succeeds).
   * Polls every 500ms until timeout.
   */
  async waitUntilListening(port: number, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now()
    const pollInterval = 500

    while (Date.now() - startTime < timeoutMs) {
      const listening = await this.isPortListening(port)
      if (listening) {
        return true
      }
      await this.sleep(pollInterval)
    }

    logger.warn(`Port ${port} not listening after ${timeoutMs}ms`)
    return false
  }

  /** Check if a port is actively listening (connection succeeds) */
  private async isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      let resolved = false

      const done = (result: boolean) => {
        if (resolved) return
        resolved = true
        socket.destroy()
        resolve(result)
      }

      socket.setTimeout(1000)
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.once('timeout', () => done(false))

      socket.connect(port, '127.0.0.1')
    })
  }

  /**
   * Get the process occupying a port.
   * Windows: netstat -ano | findstr :port → then tasklist for process name
   * Other platforms: returns null (V0.1 Windows-only)
   */
  async getOwner(port: number): Promise<PortOwner | null> {
    if (process.platform !== 'win32') {
      // Non-Windows: use lsof if available
      return this.getOwnerUnix(port)
    }

    try {
      // Step 1: netstat -ano to find PID
      const { stdout: netstatOut } = await execFileAsync('netstat', ['-ano'])
      const lines = netstatOut.split('\n')
      let pid: number | null = null

      for (const line of lines) {
        // Match lines like:  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234
        // or:               TCP    [::]:3000       [::]:0       LISTENING    1234
        const trimmed = line.trim()
        if (trimmed.includes(`:${port}`) && trimmed.includes('LISTENING')) {
          const parts = trimmed.split(/\s+/)
          const lastPart = parts[parts.length - 1]
          const parsed = parseInt(lastPart, 10)
          if (!isNaN(parsed) && parsed > 0) {
            pid = parsed
            break
          }
        }
      }

      if (pid === null) {
        return null
      }

      // Step 2: tasklist to find process name
      let name = 'unknown'
      try {
        const { stdout: tasklistOut } = await execFileAsync('tasklist', [
          '/FI',
          `PID eq ${pid}`,
          '/FO',
          'CSV',
          '/NH',
        ])
        const lines = tasklistOut.trim().split('\n')
        if (lines.length > 0) {
          // Format: "name.exe","1234","Console","1","12,345 K"
          const match = lines[0].match(/^"([^"]+)"/)
          if (match) {
            name = match[1]
          }
        }
      } catch {
        // tasklist failed, use unknown
      }

      return { port, pid, name }
    } catch (err) {
      logger.warn(`getOwner failed for port ${port}: ${(err as Error).message}`)
      return null
    }
  }

  /** Unix fallback using lsof */
  private async getOwnerUnix(port: number): Promise<PortOwner | null> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-i', `:${port}`, '-t'])
      const pid = parseInt(stdout.trim().split('\n')[0], 10)
      if (isNaN(pid)) return null

      let name = 'unknown'
      try {
        const { stdout: psOut } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='])
        name = psOut.trim()
      } catch {
        // ignore
      }

      return { port, pid, name }
    } catch {
      return null
    }
  }

  /**
   * Kill a process by PID.
   * Windows: taskkill /F /PID xxx /T
   */
  async kill(pid: number): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/F', '/PID', String(pid), '/T'])
      } else {
        await execFileAsync('kill', ['-9', String(pid)])
      }
      logger.info(`Killed PID ${pid}`)
      return true
    } catch (err) {
      logger.warn(`Failed to kill PID ${pid}: ${(err as Error).message}`)
      return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

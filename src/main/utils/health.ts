// PX Dev — Health Check Executor
// port mode: TCP connect check; http mode: HTTP GET status check

import net from 'net'
import http from 'http'
import https from 'https'
import type { Service, HealthCheckConfig } from '@shared/types'
import { logger } from './logger'

/**
 * Run a health check for a service.
 * - type='none': always returns true
 * - type='port': try TCP connect to target port
 * - type='http': HTTP GET to target URL, expect 2xx/3xx
 *
 * @returns true if healthy, false otherwise
 */
export async function runHealthCheck(service: Service): Promise<boolean> {
  const hc = service.healthCheck
  if (!hc || hc.type === 'none') {
    return true
  }

  const timeoutMs = hc.timeoutMs ?? 5000
  const intervalMs = hc.intervalMs ?? 2000
  const retries = hc.retries ?? 10

  for (let attempt = 0; attempt < retries; attempt++) {
    const healthy = await checkOnce(hc, timeoutMs)
    if (healthy) {
      logger.debug(`Health check passed for ${service.name} (attempt ${attempt + 1})`)
      return true
    }

    if (attempt < retries - 1) {
      await sleep(intervalMs)
    }
  }

  logger.warn(`Health check failed for ${service.name} after ${retries} retries`)
  return false
}

/** Run a single health check attempt */
async function checkOnce(hc: HealthCheckConfig, timeoutMs: number): Promise<boolean> {
  switch (hc.type) {
    case 'port':
      return checkPort(hc.target, timeoutMs)
    case 'http':
      return checkHttp(hc.target, timeoutMs)
    case 'none':
      return true
    default:
      return true
  }
}

/** TCP connect check to a port */
function checkPort(target: string | undefined, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!target) {
      resolve(false)
      return
    }

    const port = parseInt(target, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      resolve(false)
      return
    }

    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timeout)
      socket.destroy()
      resolve(false)
    })
    socket.once('timeout', () => {
      clearTimeout(timeout)
      socket.destroy()
      resolve(false)
    })

    socket.connect(port, '127.0.0.1')
  })
}

/** HTTP GET check, expect 2xx or 3xx status */
function checkHttp(target: string | undefined, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!target) {
      resolve(false)
      return
    }

    let url: URL
    try {
      url = new URL(target)
    } catch {
      resolve(false)
      return
    }

    const client = url.protocol === 'https:' ? https : http
    const req = client.get(target, (res) => {
      const status = res.statusCode ?? 0
      res.destroy()
      resolve(status >= 200 && status < 400)
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })

    req.once('error', () => {
      resolve(false)
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// PX Dev — PortManager Unit Tests
// Covers: available, occupied, wait listening, timeout

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PortManager } from '../src/main/managers/PortManager'
import net from 'net'

let pm: PortManager
const servers: net.Server[] = []

afterEach(async () => {
  for (const s of servers) {
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }
  servers.length = 0
})

/** Start a TCP server on a random port, return the port */
function startTestServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        servers.push(server)
        resolve({ server, port: addr.port })
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
    server.on('error', reject)
  })
}

describe('PortManager', () => {
  beforeEach(() => {
    pm = new PortManager()
  })

  it('① 空闲端口：isAvailable 返回 true', async () => {
    // 取一个真实可用端口：先 listen(0) 由系统分配，再立刻释放，然后探测这个端口。
    //
    // 为什么不用旧写法 `usedPort + 1000`：
    // Windows 临时端口区间是 49152–65535，一旦系统分配到 >= 64536 的端口，
    // +1000 就会溢出成非法端口（如 65638），net.Socket.connect 直接抛
    // RangeError: Port should be >= 0 and < 65536，测试随机失败（约 6% 概率的 flaky）。
    // 复用「刚释放的端口」既落在合法区间内，也保证确实无人监听 —— 结果确定。
    const { server, port } = await startTestServer()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    servers.splice(servers.indexOf(server), 1)

    const available = await pm.isAvailable(port)
    expect(available).toBe(true)
  })

  it('② 占用端口：isAvailable 返回 false', async () => {
    const { port } = await startTestServer()
    const available = await pm.isAvailable(port)
    expect(available).toBe(false)
  })

  it('③ waitUntilListening: 端口已监听 → 返回 true', async () => {
    const { port } = await startTestServer()
    const result = await pm.waitUntilListening(port, 5000)
    expect(result).toBe(true)
  })

  it('④ waitUntilListening: 端口未监听 → 超时返回 false', async () => {
    // Use a port that's very unlikely to be listening
    const result = await pm.waitUntilListening(59999, 3000)
    expect(result).toBe(false)
  })
})


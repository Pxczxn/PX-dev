// PX Dev — ProcessManager Unit Tests
// Covers: spawn, stdout/stderr, exit, stop, restart, forceKill

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LogManager } from '../src/main/managers/LogManager'
import {
  ProcessManager,
  ProcessError,
  describeSpawnError,
} from '../src/main/managers/ProcessManager'
import { execSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Service } from '../shared/types'

let tempDir: string
let logManager: LogManager
let pm: ProcessManager

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-pm-test-'))
  logManager = new LogManager(5000)
  pm = new ProcessManager(logManager)
})

afterEach(async () => {
  await pm.stopAll()
  rmSync(tempDir, { recursive: true, force: true })
})

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: `svc-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: 'ws-1',
    name: 'Test Service',
    type: 'node',
    role: 'backend',
    cwd: tempDir,
    command: 'node',
    args: ['-e', 'console.log("hello"); process.exit(0)'],
    enabled: true,
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ProcessManager', () => {
  it('① start: spawn node 子进程，状态 starting→running（无健康检查）', async () => {
    const svc = makeService()
    const runtime = await pm.start(svc)

    expect(runtime.serviceId).toBe(svc.id)
    expect(runtime.status).toBe('running')
    expect(runtime.ready).toBe(true)
    expect(runtime.pid).toBeDefined()
    expect(runtime.startedAt).toBeDefined()
  })

  it('② stdout 接入 LogManager', async () => {
    const svc = makeService({
      args: ['-e', 'process.stdout.write("test-stdout-output")'],
    })
    await pm.start(svc)

    // Wait for stdout to be captured
    await new Promise((resolve) => setTimeout(resolve, 300))

    const history = logManager.getHistory(svc.id)
    const hasStdout = history.some((e) => e.stream === 'stdout' && e.text.includes('test-stdout-output'))
    expect(hasStdout).toBe(true)
  })

  it('③ stderr 接入 LogManager', async () => {
    const svc = makeService({
      args: ['-e', 'process.stderr.write("test-stderr-output")'],
    })
    await pm.start(svc)

    await new Promise((resolve) => setTimeout(resolve, 300))

    const history = logManager.getHistory(svc.id)
    const hasStderr = history.some((e) => e.stream === 'stderr' && e.text.includes('test-stderr-output'))
    expect(hasStderr).toBe(true)
  })

  it('④ 进程正常退出 code=0 → exited', async () => {
    const svc = makeService({
      args: ['-e', 'process.exit(0)'],
    })
    await pm.start(svc)

    // Wait for exit
    await new Promise((resolve) => setTimeout(resolve, 500))

    const runtime = pm.getRuntime(svc.id)
    expect(runtime?.status).toBe('exited')
    expect(runtime?.exitCode).toBe(0)
  })

  it('⑤ 进程异常退出 code≠0 → failed', async () => {
    const svc = makeService({
      args: ['-e', 'process.exit(1)'],
    })
    await pm.start(svc)

    await new Promise((resolve) => setTimeout(resolve, 500))

    const runtime = pm.getRuntime(svc.id)
    expect(runtime?.status).toBe('failed')
    expect(runtime?.exitCode).toBe(1)
  })

  it('⑥ stop: tree-kill 终止进程树，状态→stopped', async () => {
    // Long-running process
    const svc = makeService({
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    await pm.start(svc)

    expect(pm.getRuntime(svc.id)?.status).toBe('running')

    const runtime = await pm.stop(svc.id)
    expect(runtime.status).toBe('stopped')
    expect(runtime.ready).toBe(false)
  })

  it('⑦ restart: stop + start', async () => {
    const svc = makeService({
      args: ['-e', 'setInterval(() => console.log("alive"), 500)'],
    })
    const r1 = await pm.start(svc)
    expect(r1.status).toBe('running')
    const oldPid = r1.pid

    const r2 = await pm.restart(svc)
    expect(r2.status).toBe('running')
    expect(r2.pid).not.toBe(oldPid)
  })

  it('⑧ forceKill: SIGKILL 强制终止', async () => {
    const svc = makeService({
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    await pm.start(svc)

    await pm.forceKill(svc.id)

    const runtime = pm.getRuntime(svc.id)
    expect(runtime?.status).toBe('stopped')
  })

  it('⑨ cwd 不存在 → 抛出 CWD_NOT_FOUND', async () => {
    const svc = makeService({
      cwd: 'D:/nonexistent/path/12345',
    })

    await expect(pm.start(svc)).rejects.toThrow()
    try {
      await pm.start(svc)
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessError)
      expect((err as ProcessError).code).toBe('CWD_NOT_FOUND')
    }
  })

  it('⑩ 重复启动 → 抛出 PROCESS_RUNNING', async () => {
    const svc = makeService({
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    await pm.start(svc)

    await expect(pm.start(svc)).rejects.toThrow()
  })

  it('⑪ 启动命令为空 → 抛出 VALIDATION_ERROR（而非裸 Error）', async () => {
    const svc = makeService({ command: '   ' })

    try {
      await pm.start(svc)
      expect.unreachable('start() 应当抛错')
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessError)
      expect((err as ProcessError).code).toBe('VALIDATION_ERROR')
      expect((err as ProcessError).message).toContain('启动命令为空')
    }
  })

  it('⑫ cwd 未配置（空串）→ 抛出 CWD_NOT_FOUND 而非 TypeError', async () => {
    const svc = makeService({ cwd: '' })

    try {
      await pm.start(svc)
      expect.unreachable('start() 应当抛错')
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessError)
      expect((err as ProcessError).code).toBe('CWD_NOT_FOUND')
      expect((err as ProcessError).message).toContain('未配置工作目录')
    }
  })
})

// ============ describeSpawnError：errno → 可操作中文提示 ============
describe('describeSpawnError', () => {
  function errWith(code: string, message = 'boom'): NodeJS.ErrnoException {
    const e = new Error(message) as NodeJS.ErrnoException
    e.code = code
    return e
  }

  it('⑬ ENOENT → 提示命令不存在 / PATH', () => {
    const msg = describeSpawnError(errWith('ENOENT'), 'npm.cmd', false)
    expect(msg).toContain('找不到命令')
    expect(msg).toContain('npm.cmd')
    expect(msg).toContain('PATH')
  })

  it('⑭ EINVAL → 提示 .cmd/.bat 必须走 shell（本次 Bug 的用户可读解释）', () => {
    const msg = describeSpawnError(errWith('EINVAL'), 'npm.cmd', false)
    expect(msg).toContain('EINVAL')
    expect(msg).toContain('npm.cmd')
    expect(msg).toContain('shell=false')
    expect(msg).toContain('Shell 模式')
  })

  it('⑮ EACCES → 提示权限问题', () => {
    const msg = describeSpawnError(errWith('EACCES'), '/usr/bin/foo', false)
    expect(msg).toContain('没有执行权限')
    expect(msg).toContain('/usr/bin/foo')
  })

  it('⑯ 未知 errno → 回退到原始 message，不吞错误', () => {
    const msg = describeSpawnError(errWith('EPERM', 'operation not permitted'), 'x', true)
    expect(msg).toContain('operation not permitted')
  })
})

// ============ 端到端回归：service:start 启动 .cmd（Windows）============
// 这是用户实际报障的路径：点击「启动」→ ProcessManager.start() → buildCommand → spawn。
// CommandBuilder 的用例⑲ 是直接调 spawn()，绕过了 ProcessManager，
// 因此必须在这一层再钉一次，否则 ProcessManager 侧回退不会被任何测试发现。
describe.runIf(process.platform === 'win32')('ProcessManager → 启动 .cmd 服务（Windows 回归）', () => {
  /** 轮询等待条件成立，避免固定 sleep 带来的偶发失败 */
  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5000,
    intervalMs = 50,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return true
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return predicate()
  }

  function isAlive(pid: number): boolean {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.includes(String(pid))
    } catch {
      return false
    }
  }

  it('⑰ 【核心回归】start() 一个 .cmd 服务不再抛 spawn EINVAL，并进入 running', async () => {
    const batPath = join(tempDir, 'hello.cmd')
    writeFileSync(batPath, '@echo off\r\necho svc-cmd-ok\r\n', 'utf-8')

    const svc = makeService({ command: batPath, args: [] })

    // 修复前：这里会抛 ProcessError「启动命令失败: spawn EINVAL」
    const runtime = await pm.start(svc)

    expect(runtime.status).toBe('running')
    expect(runtime.pid).toBeDefined()

    // 输出确实来自批处理脚本，证明进程真的跑起来了（而不是只 spawn 成功）
    const got = await waitFor(() =>
      logManager
        .getHistory(svc.id)
        .some((e) => e.stream === 'stdout' && e.text.includes('svc-cmd-ok')),
    )
    expect(got).toBe(true)
  })

  it('⑱ 路径含空格的 .cmd 也能启动（验证 quoteForCmd 在真实 cmd.exe 下生效）', async () => {
    const spacedDir = join(tempDir, 'my dir')
    mkdirSync(spacedDir, { recursive: true })
    const batPath = join(spacedDir, 'hello space.cmd')
    writeFileSync(batPath, '@echo off\r\necho spaced-ok\r\n', 'utf-8')

    const svc = makeService({ command: batPath, args: [] })
    const runtime = await pm.start(svc)

    expect(runtime.status).toBe('running')

    const got = await waitFor(() =>
      logManager
        .getHistory(svc.id)
        .some((e) => e.stream === 'stdout' && e.text.includes('spaced-ok')),
    )
    expect(got).toBe(true)
  })

  it('⑲ stop() 能杀掉 cmd.exe 之下的孙子进程（shell:true 后 pid 是 cmd.exe）', async () => {
    const batPath = join(tempDir, 'longrun.cmd')
    // .cmd 内再拉起 node：此时 child.pid 是 cmd.exe，真正的工作进程是它的子进程
    writeFileSync(
      batPath,
      '@echo off\r\nnode -e "console.log(\'GPID=\'+process.pid); setInterval(()=>{},1000)"\r\n',
      'utf-8',
    )

    const svc = makeService({ command: batPath, args: [] })
    const runtime = await pm.start(svc)
    expect(runtime.status).toBe('running')

    // 从日志里取出孙子进程 pid
    let grandchildPid = 0
    const found = await waitFor(() => {
      const text = logManager
        .getHistory(svc.id)
        .map((e) => e.text)
        .join('')
      const m = text.match(/GPID=(\d+)/)
      if (m) {
        grandchildPid = Number(m[1])
        return true
      }
      return false
    })
    expect(found).toBe(true)
    expect(grandchildPid).toBeGreaterThan(0)
    expect(isAlive(grandchildPid)).toBe(true)

    await pm.stop(svc.id)

    // tree-kill 必须连孙子进程一起收掉，否则「停止」后端口仍被占用
    const dead = await waitFor(() => !isAlive(grandchildPid))
    expect(dead).toBe(true)
    expect(pm.getRuntime(svc.id)?.status).toBe('stopped')
  })
})

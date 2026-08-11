// PX Dev — EnvironmentManager 单元测试
//
// 回归目标（Bug: Windows 环境检测恒误报「未安装」）：
// Windows 下 npm / pnpm / yarn / mvn / gradle 实际是 .cmd / .bat 包装脚本。
// 自 Node 18.20.2 / 20.12.2 起（CVE-2024-27980 缓解措施），child_process 在
// **shell 为 false** 时拒绝执行 .cmd / .bat 并抛出 `spawn EINVAL`。
// EnvironmentManager 原先用 execFile 且未传 shell 选项，于是这些环境全部检测失败。
// 修复方式：复用 command.ts 的 resolveExecutable + isWindowsBatchScript，
// 批处理脚本走 shell:true，其余命令保持 shell:false 原路径。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { EnvironmentManager } from '../src/main/managers/EnvironmentManager'
import type { EnvironmentName } from '../shared/types'

/** 单次 execFile 调用的记录 */
interface ExecCall {
  file: string
  args: readonly string[]
  options: Record<string, unknown>
}

// `promisify(execFile)` 在模块加载时就捕获了函数引用，事后 spyOn 无效，
// 只能在模块层替换 child_process.execFile，并挂上 util.promisify.custom 符号，
// 让 promisify 直接复用我们的实现（返回 { stdout, stderr }）。
const hoisted = vi.hoisted(() => {
  const calls: ExecCall[] = []
  // impl 为 null 时透传到真实 execFile（供端到端用例使用）
  const state: {
    impl: ((call: ExecCall) => Promise<{ stdout: string; stderr: string }>) | null
  } = { impl: null }
  return { calls, state }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const { promisify } = await import('util')
  const realExecFileAsync = promisify(actual.execFile)

  const execFileMock = vi.fn()
  // util.promisify.custom === Symbol.for('nodejs.util.promisify.custom')
  ;(execFileMock as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = (file: string, args: readonly string[], options: Record<string, unknown>) => {
    const call: ExecCall = { file, args, options: options ?? {} }
    hoisted.calls.push(call)
    if (hoisted.state.impl) {
      return hoisted.state.impl(call)
    }
    return (realExecFileAsync as unknown as (...a: unknown[]) => Promise<{
      stdout: string
      stderr: string
    }>)(file, args, options)
  }

  const patched = { ...actual, execFile: execFileMock }
  return { ...patched, default: patched }
})

/** 让 execFile 固定返回指定输出 */
function stubOutput(stdout: string, stderr = ''): void {
  hoisted.state.impl = async () => ({ stdout, stderr })
}

/** 版本探测调用（第 1 次 execFile） */
function versionCall(): ExecCall {
  return hoisted.calls[0]
}

/** 路径探测调用（第 2 次 execFile，where / which） */
function pathCall(): ExecCall {
  return hoisted.calls[1]
}

beforeEach(() => {
  hoisted.calls.length = 0
  stubOutput('1.0.0')
})

describe('EnvironmentManager — Windows 批处理命令（回归 spawn EINVAL）', () => {
  const batchCases: Array<{ name: EnvironmentName; executable: string }> = [
    { name: 'npm', executable: 'npm.cmd' },
    { name: 'pnpm', executable: 'pnpm.cmd' },
    { name: 'yarn', executable: 'yarn.cmd' },
    { name: 'mvn', executable: 'mvn.cmd' },
    { name: 'gradle', executable: 'gradle.bat' },
  ]

  it.each(batchCases)(
    '① win32 下 $name 重映射为 $executable 且强制 shell:true',
    async ({ name, executable }) => {
      const info = await new EnvironmentManager().detect(name, 'win32')

      expect(versionCall().file).toContain(executable)
      expect(versionCall().options.shell).toBe(true)
      expect(info.available).toBe(true)
      expect(info.version).toBe('1.0.0')
    },
  )

  it('② 批处理命令的实参拼进命令行、args 传空数组（规避 DEP0190）', async () => {
    await new EnvironmentManager().detect('mvn', 'win32')

    expect(versionCall().file).toBe('mvn.cmd --version')
    expect(versionCall().args).toEqual([])
    expect(versionCall().options.windowsHide).toBe(true)
    expect(versionCall().options.timeout).toBe(10000)
  })

  it('③ .bat 脚本（gradle）同样走命令行拼接', async () => {
    await new EnvironmentManager().detect('gradle', 'win32')

    expect(versionCall().file).toBe('gradle.bat --version')
    expect(versionCall().args).toEqual([])
  })
})

describe('EnvironmentManager — Windows 非批处理命令', () => {
  const plainCases: Array<{ name: EnvironmentName; executable: string }> = [
    { name: 'node', executable: 'node' },
    { name: 'git', executable: 'git' },
    { name: 'java', executable: 'java' },
  ]

  it.each(plainCases)(
    '④ win32 下 $name 不重映射且保持 shell:false',
    async ({ name, executable }) => {
      const info = await new EnvironmentManager().detect(name, 'win32')

      expect(versionCall().file).toBe(executable)
      expect(versionCall().options.shell).toBe(false)
      expect(info.available).toBe(true)
    },
  )
})

describe('EnvironmentManager — 非 Windows 平台', () => {
  const platforms: NodeJS.Platform[] = ['darwin', 'linux']

  it.each(platforms)('⑤ %s 下 npm 不重映射且 shell:false', async (platform) => {
    const info = await new EnvironmentManager().detect('npm', platform)

    expect(versionCall().file).toBe('npm')
    expect(versionCall().file).not.toContain('.cmd')
    expect(versionCall().options.shell).toBe(false)
    expect(info.available).toBe(true)
  })

  it('⑥ darwin 下 gradle 不会变成 gradle.bat', async () => {
    await new EnvironmentManager().detect('gradle', 'darwin')

    expect(versionCall().file).toBe('gradle')
    expect(versionCall().options.shell).toBe(false)
  })
})

describe('EnvironmentManager — getCommandPath 后缀处理', () => {
  it('⑦ win32 下 gradle.bat 查询时剥掉 .bat 后缀', async () => {
    await new EnvironmentManager().detect('gradle', 'win32')

    expect(pathCall().file).toBe('where')
    expect(pathCall().args).toEqual(['gradle'])
  })

  it('⑧ win32 下 npm.cmd 查询时剥掉 .cmd 后缀', async () => {
    await new EnvironmentManager().detect('npm', 'win32')

    expect(pathCall().file).toBe('where')
    expect(pathCall().args).toEqual(['npm'])
  })

  it('⑨ win32 下无后缀命令原样查询', async () => {
    await new EnvironmentManager().detect('node', 'win32')

    expect(pathCall().file).toBe('where')
    expect(pathCall().args).toEqual(['node'])
  })

  it('⑩ 非 win32 平台改用 which 且不剥后缀', async () => {
    await new EnvironmentManager().detect('npm', 'linux')

    expect(pathCall().file).toBe('which')
    expect(pathCall().args).toEqual(['npm'])
  })

  it('⑪ 路径解析取 where 输出的第一行', async () => {
    hoisted.state.impl = async (call) => {
      if (call.file === 'where') {
        return { stdout: 'C:\\nodejs\\npm.cmd\r\nC:\\other\\npm.cmd\r\n', stderr: '' }
      }
      return { stdout: '10.8.0', stderr: '' }
    }

    const info = await new EnvironmentManager().detect('npm', 'win32')

    expect(info.path).toBe('C:\\nodejs\\npm.cmd')
    expect(info.version).toBe('10.8.0')
  })
})

describe('EnvironmentManager — 失败与缓存行为', () => {
  it('⑫ 命令不存在时返回 available:false 且错误信息含重映射后的名字', async () => {
    hoisted.state.impl = async () => {
      throw new Error('spawn ENOENT')
    }

    const info = await new EnvironmentManager().detect('mvn', 'win32')

    expect(info.available).toBe(false)
    expect(info.version).toBe('')
    expect(info.path).toBe('')
    expect(info.error).toBe('command not found: mvn.cmd')
  })

  it('⑬ 版本输出在 stderr 时也能解析（java -version）', async () => {
    hoisted.state.impl = async (call) => {
      if (call.file === 'where') return { stdout: '', stderr: '' }
      return { stdout: '', stderr: 'openjdk version "17.0.1" 2021-10-19' }
    }

    const info = await new EnvironmentManager().detect('java', 'win32')

    expect(info.available).toBe(true)
    expect(info.version).toBe('17.0.1')
  })

  it('⑭ 命中缓存时不再重复执行命令', async () => {
    const manager = new EnvironmentManager()
    await manager.detect('npm', 'win32')
    const callsAfterFirst = hoisted.calls.length

    await manager.detect('npm', 'win32')
    expect(hoisted.calls.length).toBe(callsAfterFirst)

    manager.clearCache()
    await manager.detect('npm', 'win32')
    expect(hoisted.calls.length).toBeGreaterThan(callsAfterFirst)
  })
})

// 端到端：证明 EINVAL 已消失。
// 用真实 execFileSync 预探测 npm 是否在 PATH 上；不在则跳过（其他环境不硬失败）。
const npmOnPath = (() => {
  try {
    // 用 where / which 探测即可，无需真正执行 npm（避免自身触发 shell 相关告警）
    const probe = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(probe, ['npm'], { timeout: 10000, windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('EnvironmentManager — 端到端真实检测', () => {
  it.runIf(npmOnPath)('⑮ 真实 detect(npm) 应成功并解析出版本（EINVAL 回归）', async () => {
    hoisted.state.impl = null // 透传到真实 execFile

    const info = await new EnvironmentManager().detect('npm')

    expect(info.available).toBe(true)
    expect(info.error).toBeUndefined()
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

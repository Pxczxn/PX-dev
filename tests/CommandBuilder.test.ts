// PX Dev — Command Builder 单元测试
//
// 回归目标（Bug: spawn EINVAL）：
// Windows 下 `npm` 会被重映射成 `npm.cmd`，而自 Node 18.20.2 / 20.12.2 起
// （CVE-2024-27980 缓解措施）spawn 在 shell:false 时执行 .cmd / .bat 会**同步抛出**
// `Error: spawn EINVAL`。Electron 31 内置的 Node 20.x 正好包含该限制，
// 于是「启动前端服务」必然失败。修复方式：批处理脚本强制 shell:true + cmd 转义。

import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildCommand,
  isWindowsBatchScript,
  quoteForCmd,
  resolveExecutable,
} from '../src/main/utils/command'
import { WINDOWS_CMD_REMAP } from '../shared/constants/defaults'
import type { Service } from '../shared/types'

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    workspaceId: 'ws-1',
    name: '前端',
    type: 'frontend',
    role: 'frontend',
    cwd: 'D:/tmp',
    command: 'npm',
    args: ['run', 'dev'],
    enabled: true,
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('quoteForCmd', () => {
  it('① 普通 token 原样返回', () => {
    expect(quoteForCmd('npm.cmd')).toBe('npm.cmd')
    expect(quoteForCmd('run')).toBe('run')
    expect(quoteForCmd('--port')).toBe('--port')
  })

  it('② 空串转成显式空参数 ""', () => {
    expect(quoteForCmd('')).toBe('""')
  })

  it('③ 含空格的路径被双引号包裹', () => {
    expect(quoteForCmd('C:\\Program Files\\nodejs\\npm.cmd')).toBe(
      '"C:\\Program Files\\nodejs\\npm.cmd"',
    )
  })

  it('④ shell 元字符被双引号包裹', () => {
    expect(quoteForCmd('a&b')).toBe('"a&b"')
    expect(quoteForCmd('a|b')).toBe('"a|b"')
    expect(quoteForCmd('a>b')).toBe('"a>b"')
  })

  it('⑤ 内部双引号被转义', () => {
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""')
  })
})

describe('isWindowsBatchScript', () => {
  it('⑥ win32 下识别 .cmd / .bat（大小写不敏感）', () => {
    expect(isWindowsBatchScript('npm.cmd', 'win32')).toBe(true)
    expect(isWindowsBatchScript('foo.BAT', 'win32')).toBe(true)
  })

  it('⑦ win32 下非批处理返回 false', () => {
    expect(isWindowsBatchScript('node', 'win32')).toBe(false)
    expect(isWindowsBatchScript('bun.exe', 'win32')).toBe(false)
  })

  it('⑧ 非 Windows 平台恒为 false', () => {
    expect(isWindowsBatchScript('npm.cmd', 'linux')).toBe(false)
    expect(isWindowsBatchScript('npm.cmd', 'darwin')).toBe(false)
  })
})

describe('buildCommand', () => {
  it('⑨ 【核心回归】win32 + npm → npm.cmd 且强制 shell:true（否则 spawn EINVAL）', () => {
    const built = buildCommand(makeService(), 'win32')

    // shell 模式下命令行由我们自己拼好，args 清空（等价于 Node 内部的 join）
    expect(built.executable).toBe('npm.cmd run dev')
    expect(built.args).toEqual([])
    // 关键断言：批处理脚本必须走 shell，这正是 EINVAL 的修复点
    expect(built.options.shell).toBe(true)
    expect(built.options.windowsHide).toBe(true)
  })

  it('⑩ win32 + 非批处理命令（node）保持 shell:false', () => {
    const built = buildCommand(
      makeService({ command: 'node', args: ['-e', 'console.log(1)'] }),
      'win32',
    )

    expect(built.executable).toBe('node')
    expect(built.options.shell).toBe(false)
  })

  it('⑪ win32 + bun 重映射为 bun.exe，不需要 shell', () => {
    const built = buildCommand(makeService({ command: 'bun', args: ['dev'] }), 'win32')

    expect(built.executable).toBe('bun.exe')
    expect(built.options.shell).toBe(false)
  })

  it('⑫ 非 Windows 平台不重映射、不改 shell', () => {
    const built = buildCommand(makeService(), 'linux')

    expect(built.executable).toBe('npm')
    expect(built.args).toEqual(['run', 'dev'])
    expect(built.options.shell).toBe(false)
  })

  it('⑬ win32 批处理模式下，带空格的实参被正确转义', () => {
    const built = buildCommand(
      makeService({ args: ['run', 'build --out "my dir"'] }),
      'win32',
    )

    expect(built.options.shell).toBe(true)
    expect(built.executable).toBe('npm.cmd run "build --out \\"my dir\\""')
    expect(built.args).toEqual([])
  })

  it('⑭ win32 批处理模式下，带空格的可执行文件路径被引号包裹', () => {
    const built = buildCommand(
      makeService({ command: 'C:\\Program Files\\nodejs\\npm.cmd' }),
      'win32',
    )

    expect(built.executable).toBe('"C:\\Program Files\\nodejs\\npm.cmd" run dev')
    expect(built.options.shell).toBe(true)
  })

  it('⑮ shellMode=true 时命令原样透传，不做重映射与转义', () => {
    const built = buildCommand(
      makeService({ command: 'npm run dev', args: [], shellMode: true }),
      'win32',
    )

    expect(built.executable).toBe('npm run dev')
    expect(built.args).toEqual([])
    expect(built.options.shell).toBe(true)
  })

  it('⑯ shellMode=true 且带 args 时，拼成单行命令（等价于 Node 内部 join）', () => {
    const built = buildCommand(
      makeService({ command: 'npm', args: ['run', 'dev'], shellMode: true }),
      'win32',
    )

    expect(built.executable).toBe('npm run dev')
    expect(built.args).toEqual([])
    expect(built.options.shell).toBe(true)
  })

  it('⑰ 命令为空（含纯空白）时抛出明确错误', () => {
    expect(() => buildCommand(makeService({ command: '' }), 'win32')).toThrow('启动命令为空')
    expect(() => buildCommand(makeService({ command: '   ' }), 'win32')).toThrow('启动命令为空')
  })

  it('⑱ args 中的非字符串元素被过滤（防御损坏配置）', () => {
    const built = buildCommand(
      makeService({
        command: 'node',
        args: ['-e', null as unknown as string, 'console.log(1)'],
      }),
      'win32',
    )

    expect(built.args).toEqual(['-e', 'console.log(1)'])
  })

  it('⑲ env 合并 process.env 与服务自定义变量', () => {
    const built = buildCommand(makeService({ env: { PX_DEV_TEST_FLAG: '1' } }), 'linux')

    expect(built.options.env.PX_DEV_TEST_FLAG).toBe('1')
    expect(built.options.env.PATH ?? built.options.env.Path).toBeDefined()
  })
})

// ============ 真实 spawn 验证（仅 Windows）============
describe.runIf(process.platform === 'win32')('buildCommand → 真实 spawn（Windows）', () => {
  it('⑳ 用 buildCommand 的产物 spawn 一个 .cmd 不再抛 EINVAL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxdev-cmd-test-'))
    const batPath = join(dir, 'hello.cmd')
    writeFileSync(batPath, '@echo off\r\necho batch-ok\r\n', 'utf-8')

    try {
      const built = buildCommand(
        makeService({ command: batPath, args: [], cwd: dir }),
        'win32',
      )

      // 修复的直接体现：批处理脚本必须被切到 shell 才能 spawn
      expect(built.options.shell).toBe(true)

      // 修复前：下面这行 spawn 会同步抛出 Error: spawn EINVAL
      const output = await new Promise<string>((resolvePromise, rejectPromise) => {
        let stdout = ''
        const child = spawn(built.executable, built.args, {
          ...built.options,
          cwd: dir,
        })
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.on('error', rejectPromise)
        // 用 'close' 而非 'exit'：'exit' 只表示进程已退出，stdio 可能尚未 flush 完，
        // 用 'exit' 会偶发拿到被截断的 stdout（假失败）。'close' 保证流已全部关闭。
        child.on('close', () => resolvePromise(stdout))
      })

      expect(output).toContain('batch-ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('㉑ 反例验证：shell:false 直接 spawn .cmd 必定抛 EINVAL（证明根因）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxdev-cmd-test-'))
    const batPath = join(dir, 'hello.cmd')
    writeFileSync(batPath, '@echo off\r\necho batch-ok\r\n', 'utf-8')

    try {
      expect(() => spawn(batPath, [], { cwd: dir, shell: false })).toThrow(/EINVAL/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ============ A. Java 系构建工具重映射（mvn / mvnw / gradle / gradlew）============
//
// 与 npm 同源的问题：Windows 上 Maven / Gradle 的入口同样是批处理包装脚本
// （mvn.cmd / mvnw.cmd / gradle.bat / gradlew.bat），因此必须同时满足两点：
//   1) 用户填 `mvn` 时补齐真实后缀，否则 spawn 在 PATH 里找不到无后缀的可执行文件；
//   2) 补齐后是 .cmd / .bat，必须强制 shell:true，否则新版 Node 抛 spawn EINVAL。
describe('Windows 重映射扩充 — Java 系构建工具', () => {
  it('㉒ resolveExecutable 在 win32 下把 mvn/mvnw/gradle/gradlew 映射为对应脚本', () => {
    expect(resolveExecutable('mvn', 'win32')).toBe('mvn.cmd')
    expect(resolveExecutable('mvnw', 'win32')).toBe('mvnw.cmd')
    expect(resolveExecutable('gradle', 'win32')).toBe('gradle.bat')
    expect(resolveExecutable('gradlew', 'win32')).toBe('gradlew.bat')
  })

  it('㉓ 重映射常量表本身包含全部 4 条新增条目，且未破坏既有条目', () => {
    // 新增：Java 系
    expect(WINDOWS_CMD_REMAP.mvn).toBe('mvn.cmd')
    expect(WINDOWS_CMD_REMAP.mvnw).toBe('mvnw.cmd')
    expect(WINDOWS_CMD_REMAP.gradle).toBe('gradle.bat')
    expect(WINDOWS_CMD_REMAP.gradlew).toBe('gradlew.bat')
    // 既有：Node 系（防止扩充时误删）
    expect(WINDOWS_CMD_REMAP.npm).toBe('npm.cmd')
    expect(WINDOWS_CMD_REMAP.pnpm).toBe('pnpm.cmd')
    expect(WINDOWS_CMD_REMAP.yarn).toBe('yarn.cmd')
    expect(WINDOWS_CMD_REMAP.bun).toBe('bun.exe')
    expect(WINDOWS_CMD_REMAP.npx).toBe('npx.cmd')
    expect(WINDOWS_CMD_REMAP.tsx).toBe('tsx.cmd')
  })

  it('㉔ 【核心】win32 + mvn → mvn.cmd 且强制 shell:true', () => {
    const built = buildCommand(
      makeService({ command: 'mvn', args: ['clean', 'package'] }),
      'win32',
    )

    expect(built.executable).toBe('mvn.cmd clean package')
    expect(built.args).toEqual([])
    expect(built.options.shell).toBe(true)
    expect(built.options.windowsHide).toBe(true)
  })

  it('㉕ 【核心】win32 + mvnw → mvnw.cmd 且强制 shell:true', () => {
    const built = buildCommand(
      makeService({ command: 'mvnw', args: ['spring-boot:run'] }),
      'win32',
    )

    expect(built.executable).toBe('mvnw.cmd spring-boot:run')
    expect(built.args).toEqual([])
    expect(built.options.shell).toBe(true)
  })

  it('㉖ 【核心】win32 + gradle → gradle.bat 且强制 shell:true', () => {
    const built = buildCommand(
      makeService({ command: 'gradle', args: ['build'] }),
      'win32',
    )

    expect(built.executable).toBe('gradle.bat build')
    expect(built.args).toEqual([])
    expect(built.options.shell).toBe(true)
  })

  it('㉗ 【核心】win32 + gradlew → gradlew.bat 且强制 shell:true', () => {
    const built = buildCommand(
      makeService({ command: 'gradlew', args: ['bootRun'] }),
      'win32',
    )

    expect(built.executable).toBe('gradlew.bat bootRun')
    expect(built.args).toEqual([])
    expect(built.options.shell).toBe(true)
  })

  it('㉘ win32 下重映射与大小写无关（MVN / Gradlew 同样命中）', () => {
    expect(resolveExecutable('MVN', 'win32')).toBe('mvn.cmd')
    expect(resolveExecutable('Gradlew', 'win32')).toBe('gradlew.bat')
  })
})

// ============ B. 已带扩展名不二次追加 ============
//
// resolveExecutable 的 hasExt 守卫（/\.(exe|cmd|bat|ps1)$/i）保证：
// 用户已经写全后缀时不再查表，避免出现 npm.cmd.cmd / gradle.bat.bat 这类死路径。
describe('Windows 重映射 — 已带扩展名不二次追加', () => {
  it('㉙ npm.cmd 保持原样，不会变成 npm.cmd.cmd', () => {
    expect(resolveExecutable('npm.cmd', 'win32')).toBe('npm.cmd')

    const built = buildCommand(makeService({ command: 'npm.cmd', args: [] }), 'win32')
    expect(built.executable).toBe('npm.cmd')
    // 后缀只出现一次：'npm.cmd'.split('.cmd') === ['npm', '']
    expect(built.executable.split('.cmd')).toHaveLength(2)
    expect(built.executable.endsWith('npm.cmd.cmd')).toBe(false)
    // 依旧是批处理脚本，仍需 shell:true
    expect(built.options.shell).toBe(true)
  })

  it('㉚ gradle.bat 保持原样，不会变成 gradle.bat.bat', () => {
    expect(resolveExecutable('gradle.bat', 'win32')).toBe('gradle.bat')

    const built = buildCommand(makeService({ command: 'gradle.bat', args: [] }), 'win32')
    expect(built.executable).toBe('gradle.bat')
    expect(built.executable.split('.bat')).toHaveLength(2)
    expect(built.executable.endsWith('gradle.bat.bat')).toBe(false)
    expect(built.options.shell).toBe(true)
  })

  it('㉛ bun.exe 保持原样，不会变成 bun.exe.exe，且不需要 shell', () => {
    expect(resolveExecutable('bun.exe', 'win32')).toBe('bun.exe')

    const built = buildCommand(makeService({ command: 'bun.exe', args: ['dev'] }), 'win32')
    expect(built.executable).toBe('bun.exe')
    expect(built.executable.split('.exe')).toHaveLength(2)
    expect(built.executable.endsWith('bun.exe.exe')).toBe(false)
    // .exe 不是批处理脚本，保持结构化 spawn
    expect(built.args).toEqual(['dev'])
    expect(built.options.shell).toBe(false)
  })

  it('㉜ hasExt 守卫大小写不敏感（MVN.CMD / GRADLE.BAT / .ps1 均不再追加）', () => {
    expect(resolveExecutable('MVN.CMD', 'win32')).toBe('MVN.CMD')
    expect(resolveExecutable('GRADLE.BAT', 'win32')).toBe('GRADLE.BAT')
    expect(resolveExecutable('mvn.ps1', 'win32')).toBe('mvn.ps1')
  })
})

// ============ C. 非 Windows 平台不重映射 ============
describe('非 Windows 平台 — Java 系构建工具原样透传', () => {
  it('㉝ darwin / linux 下 mvn 不重映射且 shell 保持 false', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const built = buildCommand(
        makeService({ command: 'mvn', args: ['clean', 'package'] }),
        platform,
      )

      expect(built.executable).toBe('mvn')
      expect(built.args).toEqual(['clean', 'package'])
      expect(built.options.shell).toBe(false)
    }
  })

  it('㉞ darwin / linux 下 mvnw / gradle / gradlew 同样原样返回', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(resolveExecutable('mvn', platform)).toBe('mvn')
      expect(resolveExecutable('mvnw', platform)).toBe('mvnw')
      expect(resolveExecutable('gradle', platform)).toBe('gradle')
      expect(resolveExecutable('gradlew', platform)).toBe('gradlew')
    }
  })

  it('㉟ 非 Windows 下 ./gradlew 这类相对路径脚本不会被误加后缀', () => {
    const built = buildCommand(
      makeService({ command: './gradlew', args: ['bootRun'] }),
      'linux',
    )

    expect(built.executable).toBe('./gradlew')
    expect(built.args).toEqual(['bootRun'])
    expect(built.options.shell).toBe(false)
  })
})

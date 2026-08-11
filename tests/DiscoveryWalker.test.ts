// PX Dev — DirectoryWalker 单元测试
// 覆盖：忽略清单、maxDepth、maxDirectories 限额、符号链接跳过、root 不存在

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, sep } from 'path'
import { DirectoryWalker, DiscoveryError } from '../src/main/discovery'

let tempDir: string
let walker: DirectoryWalker

/**
 * 探测当前环境能否创建符号链接。
 * Windows 未开启开发者模式 / 非管理员时会抛 EPERM，此时对应用例整体跳过。
 */
const SYMLINK_SUPPORTED = (() => {
  const probeDir = mkdtempSync(join(tmpdir(), 'pxdev-symlink-probe-'))
  try {
    mkdirSync(join(probeDir, 'target'))
    symlinkSync(join(probeDir, 'target'), join(probeDir, 'link'), 'junction')
    return true
  } catch {
    return false
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
})()

/** 创建目录并可选写入一个 package.json，使其成为候选目录 */
function makeProjectDir(...segments: string[]): string {
  const dir = join(tempDir, ...segments)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: segments.join('-') }))
  return dir
}

/** 绝对路径 → 相对 tempDir 的 posix 风格路径 */
function rel(target: string): string {
  const r = relative(tempDir, target)
  return r === '' ? '.' : r.split(sep).join('/')
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-walk-test-'))
  walker = new DirectoryWalker()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('DirectoryWalker', () => {
  it('① 忽略清单命中：node_modules / dist / target / .git 内部不被访问', () => {
    // 正常项目
    makeProjectDir('web')
    // 忽略目录内部即便含 package.json 也不应成为候选
    makeProjectDir('node_modules', 'lodash')
    makeProjectDir('dist', 'inner')
    makeProjectDir('target', 'classes')
    makeProjectDir('.git', 'hooks')

    const result = walker.walk(tempDir, { maxDepth: 5 })
    const candidates = result.candidates.map(rel)

    expect(candidates).toContain('web')
    expect(candidates.some((p) => p.includes('node_modules'))).toBe(false)
    expect(candidates.some((p) => p.includes('dist'))).toBe(false)
    expect(candidates.some((p) => p.includes('target'))).toBe(false)
    expect(candidates.some((p) => p.includes('.git'))).toBe(false)
    // 忽略目录本身也不会被计入访问数（root + web = 2）
    expect(result.stats.scannedDirectories).toBe(2)
    expect(result.stats.skippedDirectories).toBe(4)
  })

  it('② maxDepth=1：只访问根与一层子目录，孙目录不扫', () => {
    makeProjectDir('level1')
    makeProjectDir('level1', 'level2')
    makeProjectDir('level1', 'level2', 'level3')

    const result = walker.walk(tempDir, { maxDepth: 1 })
    const candidates = result.candidates.map(rel)

    expect(candidates).toContain('level1')
    expect(candidates).not.toContain('level1/level2')
    expect(candidates).not.toContain('level1/level2/level3')
    // root(depth=0) + level1(depth=1)
    expect(result.stats.scannedDirectories).toBe(2)
    expect(result.stats.maxDepthReached).toBe(1)
    expect(result.stats.truncated).toBe(false)
  })

  it('③ maxDirectories=5：触发 DISCOVERY_DIRECTORY_LIMIT + truncated=true', () => {
    // 根下建 10 个子目录，确保远超限额
    for (let i = 0; i < 10; i += 1) {
      mkdirSync(join(tempDir, `p${i}`), { recursive: true })
    }

    const result = walker.walk(tempDir, { maxDepth: 3, maxDirectories: 5 })

    expect(result.stats.truncated).toBe(true)
    expect(result.stats.scannedDirectories).toBe(5)
    expect(result.warnings.some((w) => w.code === 'DISCOVERY_DIRECTORY_LIMIT')).toBe(true)
  })

  it.skipIf(!SYMLINK_SUPPORTED)('④ 符号链接：跳过并产生 DISCOVERY_SYMLINK_SKIPPED', () => {
    const realDir = makeProjectDir('real')
    symlinkSync(realDir, join(tempDir, 'link'), 'junction')

    const result = walker.walk(tempDir, { maxDepth: 3 })
    const candidates = result.candidates.map(rel)

    expect(candidates).toContain('real')
    expect(candidates).not.toContain('link')
    const symlinkWarning = result.warnings.find((w) => w.code === 'DISCOVERY_SYMLINK_SKIPPED')
    expect(symlinkWarning).toBeDefined()
    expect(symlinkWarning?.path).toBe('link')
  })

  it('⑤ root 不存在：抛出 DISCOVERY_ROOT_NOT_FOUND', () => {
    const missing = join(tempDir, 'not-exists-dir')

    expect(() => walker.walk(missing)).toThrow(DiscoveryError)
    try {
      walker.walk(missing)
      expect.unreachable('应当抛出 DiscoveryError')
    } catch (err) {
      expect((err as DiscoveryError).code).toBe('DISCOVERY_ROOT_NOT_FOUND')
    }
  })
})

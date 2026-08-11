// PX Dev — Monorepo library 过滤集成测试
//
// 固件结构：
//   root/                 package.json（workspaces）→ monorepo 根，isLibrary=true
//   root/packages/ui      package.json 无任何 dev/start/serve 脚本 → library
//   root/apps/web         package.json + vite → 可运行前端应用

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ScannerRegistry } from '../src/main/scanners'
import { WorkspaceDiscoveryManager } from '../src/main/discovery'
import { WorkspaceDiscoveryResultSchema } from '../shared/schemas'

let tempDir: string
let manager: WorkspaceDiscoveryManager

/** 在相对路径下写一个 package.json */
function writePkg(relativePath: string, pkg: Record<string, unknown>): void {
  const dir = relativePath === '.' ? tempDir : join(tempDir, relativePath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-monorepo-test-'))
  manager = new WorkspaceDiscoveryManager(new ScannerRegistry())

  // monorepo 根
  writePkg('.', { name: 'root', private: true, workspaces: ['packages/*', 'apps/*'] })
  // library：只有 build 脚本
  writePkg('packages/ui', { name: '@demo/ui', scripts: { build: 'tsc' } })
  // 可运行前端应用
  writePkg('apps/web', {
    name: '@demo/web',
    scripts: { dev: 'vite' },
    dependencies: { vue: '^3.4.0' },
    devDependencies: { vite: '^5.0.0' },
  })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Monorepo library 识别与过滤', () => {
  it('① includeLibrary=false（默认）：ui 与 monorepo 根都不进入 projects', async () => {
    const result = await manager.discover(tempDir)

    const paths = result.projects.map((p) => p.relativePath)
    expect(paths).toContain('apps/web')
    expect(paths).not.toContain('packages/ui')
    expect(paths).not.toContain('.')

    const web = result.projects.find((p) => p.relativePath === 'apps/web')
    expect(web?.isLibrary).toBe(false)
    expect(web?.suggestedSelected).toBe(true)
    expect(web?.framework).toBe('vue')
    expect(web?.projectType).toBe('frontend')
    expect(web?.suggestedServiceType).toBe('frontend')
    expect(web?.packageManager).toBe('npm')
    expect(web?.command).toBe('npm')
    expect(web?.args).toEqual(['run', 'dev'])
  })

  it('② includeLibrary=true：ui 出现在 projects 但 suggestedSelected=false', async () => {
    const result = await manager.discover(tempDir, { includeLibrary: true })

    const ui = result.projects.find((p) => p.relativePath === 'packages/ui')
    expect(ui).toBeDefined()
    expect(ui?.isLibrary).toBe(true)
    expect(ui?.suggestedSelected).toBe(false)

    // 非 library 项目仍默认勾选
    const web = result.projects.find((p) => p.relativePath === 'apps/web')
    expect(web?.suggestedSelected).toBe(true)
  })

  it('③ monorepo 根自身被判定为 library（含 workspaces 字段）', async () => {
    const result = await manager.discover(tempDir, { includeLibrary: true })

    const root = result.projects.find((p) => p.relativePath === '.')
    expect(root?.isLibrary).toBe(true)
    expect(root?.suggestedSelected).toBe(false)
    expect(root?.evidence.some((e) => e.type === 'monorepo-root')).toBe(true)
  })

  it('④ 结果仍满足 schema 校验且可结构化克隆', async () => {
    const result = await manager.discover(tempDir, { includeLibrary: true })

    expect(WorkspaceDiscoveryResultSchema.safeParse(result).success).toBe(true)
    expect(() => structuredClone(result)).not.toThrow()
  })
})

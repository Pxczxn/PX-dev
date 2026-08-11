// PX Dev — WorkspaceDiscoveryManager 集成测试
// 覆盖：多子项目发现、根目录自身项目、解析失败降级、结果 schema 校验

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ScannerRegistry } from '../src/main/scanners'
import { WorkspaceDiscoveryManager } from '../src/main/discovery'
import { WorkspaceDiscoveryResultSchema } from '../shared/schemas'

let tempDir: string
let manager: WorkspaceDiscoveryManager

/** 在子目录写一个 Node 项目 */
function writeNodeProject(name: string, content?: string): void {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    content ?? JSON.stringify({ name, scripts: { dev: 'vite' } }),
  )
}

/**
 * 在子目录写一个 Maven 项目。
 * 含 spring-boot-starter-web —— Phase 2 的 library 规则会把「无 starter-web / 无 boot 插件」
 * 的 pom 判为不可独立启动的模块并过滤掉，因此固件需要是一个真实可运行的 Spring Boot 应用。
 */
function writeMavenProject(name: string): void {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'pom.xml'),
    `<?xml version="1.0"?><project><dependencies><dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency></dependencies></project>`,
  )
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-discovery-test-'))
  manager = new WorkspaceDiscoveryManager(new ScannerRegistry())
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('WorkspaceDiscoveryManager', () => {
  it('① web + admin + backend 三个子项目全部被发现', async () => {
    writeNodeProject('web')
    writeNodeProject('admin')
    writeMavenProject('backend')

    const result = await manager.discover(tempDir)

    expect(result.projects).toHaveLength(3)

    const byPath = new Map(result.projects.map((p) => [p.relativePath, p]))
    // Phase 2：scripts.dev = 'vite' 被 FrameworkDetector 精化为 frontend
    expect(byPath.get('web')?.projectType).toBe('frontend')
    expect(byPath.get('admin')?.projectType).toBe('frontend')
    expect(byPath.get('backend')?.projectType).toBe('java')
    expect(byPath.get('web')?.confidence).toBe('high')
    expect(byPath.get('web')?.configFiles).toContain('package.json')
    expect(byPath.get('backend')?.configFiles).toContain('pom.xml')
    // Phase 2 填充：framework / packageManager / command / args
    expect(byPath.get('web')?.framework).toBe('vite')
    expect(byPath.get('web')?.packageManager).toBe('npm')
    expect(byPath.get('web')?.command).toBe('npm')
    expect(byPath.get('web')?.args).toEqual(['run', 'dev'])
    expect(byPath.get('backend')?.framework).toBe('spring-boot')
    expect(byPath.get('backend')?.packageManager).toBe('maven')
    expect(byPath.get('backend')?.command).toBe('mvn')
    expect(byPath.get('backend')?.args).toEqual(['spring-boot:run'])
    // Phase 4 填充端口：web 无显式端口 → 框架默认 5173（低可信、标灰「推测端口」）
    expect(byPath.get('web')?.detectedPort).toBe(5173)
    expect(byPath.get('web')?.endpoints?.[0]).toMatchObject({
      type: 'local',
      port: 5173,
      url: 'http://localhost:5173',
      source: 'framework-default',
      confidence: 'low',
    })
    // spring-boot 无 application.* 配置 → 框架默认 8080
    expect(byPath.get('backend')?.detectedPort).toBe(8080)
    // 端口可信度不参与项目整体 confidence，避免所有项目被兜底端口拉低
    expect(byPath.get('web')?.confidence).toBe('high')
  })

  it('①-3 Phase 4：真实 vite.config.ts（server.port=5174）→ detectedPort=5174、来源 config', async () => {
    writeNodeProject('web')
    writeFileSync(
      join(tempDir, 'web', 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nexport default defineConfig({ server: { port: 5174 } })\n",
    )

    const result = await manager.discover(tempDir)
    const web = result.projects.find((p) => p.relativePath === 'web')

    expect(web?.detectedPort).toBe(5174)
    expect(web?.endpoints?.[0]).toMatchObject({
      port: 5174,
      source: 'config',
      confidence: 'high',
      url: 'http://localhost:5174',
    })
    // 端点必须能通过出参 schema（.strict()），否则 workspace:discover 会 500
    expect(() => WorkspaceDiscoveryResultSchema.parse(result)).not.toThrow()
  })

  it('①-4 Phase 4：.env 端口优先于框架默认，命令行参数又优先于 .env', async () => {
    writeNodeProject('envapp')
    writeFileSync(join(tempDir, 'envapp', '.env'), 'PORT=3010\n')
    writeNodeProject(
      'cmdapp',
      JSON.stringify({ name: 'cmdapp', scripts: { dev: 'vite --port 5180' } }),
    )
    writeFileSync(join(tempDir, 'cmdapp', '.env'), 'PORT=3010\n')

    const result = await manager.discover(tempDir)
    const byPath = new Map(result.projects.map((p) => [p.relativePath, p]))

    expect(byPath.get('envapp')?.detectedPort).toBe(3010)
    expect(byPath.get('envapp')?.endpoints?.[0].source).toBe('env')
    expect(byPath.get('cmdapp')?.detectedPort).toBe(5180)
    expect(byPath.get('cmdapp')?.endpoints?.[0].source).toBe('command')
  })

  it('①-2 suggestedServiceType 映射：vite→frontend、nest→node、pom→java', async () => {
    writeNodeProject('web') // scripts.dev = 'vite'
    writeNodeProject(
      'api',
      JSON.stringify({
        name: 'api',
        scripts: { start: 'nest start --watch' },
        dependencies: { '@nestjs/core': '^10.0.0' },
      }),
    )
    writeMavenProject('backend')

    const result = await manager.discover(tempDir)
    const byPath = new Map(result.projects.map((p) => [p.relativePath, p]))

    expect(byPath.get('web')?.framework).toBe('vite')
    expect(byPath.get('web')?.suggestedServiceType).toBe('frontend')

    expect(byPath.get('api')?.framework).toBe('nest')
    expect(byPath.get('api')?.projectType).toBe('node')
    expect(byPath.get('api')?.suggestedServiceType).toBe('node')

    expect(byPath.get('backend')?.suggestedServiceType).toBe('java')

    // 三者均非 library，默认全部勾选
    expect(result.projects.every((p) => p.suggestedSelected === true)).toBe(true)
  })

  it('② 根目录自身含 package.json 时，结果包含 relativePath="." 的项', async () => {
    // 需含可启动脚本，否则 Phase 2 的 library 规则会把它过滤掉
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'root-app', scripts: { start: 'node server.js' } }),
    )
    writeNodeProject('web')

    const result = await manager.discover(tempDir)

    const rootProject = result.projects.find((p) => p.relativePath === '.')
    expect(rootProject).toBeDefined()
    expect(rootProject?.projectType).toBe('node')
    expect(rootProject?.path).toBe(result.rootPath)
    expect(result.projects).toHaveLength(2)
  })

  it('③ 某子目录 package.json 非法 JSON → PARSE_FAILED warning，其余项目仍正常返回', async () => {
    writeNodeProject('web')
    writeNodeProject('broken', '{ this is not valid json ')
    writeMavenProject('backend')

    const result = await manager.discover(tempDir)

    // 三个候选都返回，损坏的那个降级为 low
    expect(result.projects).toHaveLength(3)
    const broken = result.projects.find((p) => p.relativePath === 'broken')
    expect(broken?.confidence).toBe('low')

    const parseWarning = result.warnings.find((w) => w.code === 'DISCOVERY_PARSE_FAILED')
    expect(parseWarning).toBeDefined()
    expect(parseWarning?.path).toBe('broken/package.json')

    // 其余两个不受影响
    const web = result.projects.find((p) => p.relativePath === 'web')
    const backend = result.projects.find((p) => p.relativePath === 'backend')
    expect(web?.confidence).toBe('high')
    expect(backend?.confidence).toBe('high')
  })

  it('④ 结果通过 WorkspaceDiscoveryResultSchema 校验且可结构化克隆', async () => {
    writeNodeProject('web')
    writeMavenProject('backend')

    const result = await manager.discover(tempDir)

    const parsed = WorkspaceDiscoveryResultSchema.safeParse(result)
    expect(parsed.success).toBe(true)

    // 纯数据：无 class instance / function / FS handle
    expect(() => structuredClone(result)).not.toThrow()
  })

  it('⑤ ScannerRegistry.probe 低成本判定目录种类', () => {
    writeNodeProject('web')
    writeMavenProject('backend')
    mkdirSync(join(tempDir, 'plain'), { recursive: true })

    const registry = new ScannerRegistry()
    expect(registry.probe(join(tempDir, 'web'))).toBe('node')
    expect(registry.probe(join(tempDir, 'backend'))).toBe('maven')
    expect(registry.probe(join(tempDir, 'plain'))).toBeNull()
    // probe 不改变 scan 的既有行为
    expect(registry.scan(join(tempDir, 'web')).type).toBe('node')
  })
})

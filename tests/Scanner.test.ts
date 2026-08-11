// PX Dev — Scanner Unit Tests
// Covers: npm, pnpm, yarn, Maven, Gradle, unknown

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ScannerRegistry } from '../src/main/scanners'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let tempDir: string
let registry: ScannerRegistry

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-scan-test-'))
  registry = new ScannerRegistry()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ScannerRegistry', () => {
  it('① npm 项目：识别 package.json + package-lock.json', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-npm',
        scripts: { dev: 'vite', start: 'node index.js' },
      }),
    )
    writeFileSync(join(tempDir, 'package-lock.json'), '{}')

    const result = registry.scan(tempDir)
    expect(result.type).toBe('node')
    expect(result.packageManager).toBe('npm')
    expect(result.recommendedCommand).toBe('npm')
    expect(result.recommendedArgs).toEqual(['run', 'dev'])
    expect(result.scripts?.dev).toBe('vite')
    // Phase 2 增强字段
    expect(result.framework).toBe('vite')
    expect(result.projectType).toBe('frontend')
    expect(result.isLibrary).toBe(false)
    expect(result.configFiles).toContain('package-lock.json')
  })

  it('② pnpm 项目：识别 pnpm-lock.yaml', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-pnpm',
        scripts: { dev: 'vite --port 3001' },
      }),
    )
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '')

    const result = registry.scan(tempDir)
    expect(result.type).toBe('node')
    expect(result.packageManager).toBe('pnpm')
    expect(result.recommendedCommand).toBe('pnpm')
    expect(result.recommendedArgs).toEqual(['run', 'dev'])
    expect(result.detectedPort).toBe(3001)
    expect(result.framework).toBe('vite')
    expect(result.isLibrary).toBe(false)
  })

  it('③ yarn 项目：识别 yarn.lock', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-yarn',
        scripts: { start: 'node server.js' },
      }),
    )
    writeFileSync(join(tempDir, 'yarn.lock'), '')

    const result = registry.scan(tempDir)
    expect(result.type).toBe('node')
    expect(result.packageManager).toBe('yarn')
    expect(result.recommendedCommand).toBe('yarn')
    expect(result.recommendedArgs).toEqual(['start'])
    // 纯 Node 服务：无前端框架特征，不得被误判为 frontend
    expect(result.projectType).toBe('node')
    expect(result.framework).toBeUndefined()
  })

  it('③-2 无 dev/start/serve 脚本的纯 library 包：isLibrary=true', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-lib', scripts: { build: 'tsc' } }),
    )

    const result = registry.scan(tempDir)
    expect(result.type).toBe('node')
    expect(result.isLibrary).toBe(true)
  })

  it('④ Maven 项目：识别 pom.xml + mvnw', () => {
    writeFileSync(
      join(tempDir, 'pom.xml'),
      `<?xml version="1.0"?>
      <project>
        <dependencies>
          <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
          </dependency>
        </dependencies>
      </project>`,
    )
    writeFileSync(join(tempDir, 'mvnw'), '#!/bin/sh')

    const result = registry.scan(tempDir)
    expect(result.type).toBe('maven')
    // wrapper 存在 → 推荐 wrapper；输出**基名**，Windows 下的 mvnw.cmd 重映射
    // 由 buildCommand → resolveExecutable + WINDOWS_CMD_REMAP 负责（'./mvnw' 会绕过重映射表）
    expect(result.recommendedCommand).toBe('mvnw')
    expect(result.recommendedArgs).toEqual(['spring-boot:run'])
    expect(result.detectedPort).toBe(8080)
    expect(result.framework).toBe('spring-boot')
    expect(result.projectType).toBe('java')
    expect(result.isLibrary).toBe(false)
  })

  it('④-2 Maven 无 wrapper：回落到 mvn', () => {
    writeFileSync(
      join(tempDir, 'pom.xml'),
      `<?xml version="1.0"?><project><build><plugins><plugin>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin></plugins></build></project>`,
    )

    const result = registry.scan(tempDir)
    expect(result.recommendedCommand).toBe('mvn')
    expect(result.recommendedArgs).toEqual(['spring-boot:run'])
  })

  it('⑤ Gradle 项目：识别 build.gradle + gradlew', () => {
    writeFileSync(
      join(tempDir, 'build.gradle'),
      `plugins {
        id 'org.springframework.boot'
      }`,
    )
    writeFileSync(join(tempDir, 'gradlew'), '#!/bin/sh')

    const result = registry.scan(tempDir)
    expect(result.type).toBe('gradle')
    // 同 ④：输出基名 gradlew，Windows 下由 WINDOWS_CMD_REMAP 转 gradlew.bat
    expect(result.recommendedCommand).toBe('gradlew')
    expect(result.recommendedArgs).toEqual(['bootRun'])
    expect(result.framework).toBe('spring-boot')
    expect(result.projectType).toBe('java')
    expect(result.isLibrary).toBe(false)
  })

  // —— Phase 4：detectPort 委托 PortDetector 后的回归（行为一致或增强）——

  it('⑤-2 Node：vite.config.ts 的 server.port 仍被识别', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'web', scripts: { dev: 'vite' } }),
    )
    writeFileSync(
      join(tempDir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nexport default defineConfig({ server: { port: 4100 } })\n",
    )

    expect(registry.scan(tempDir).detectedPort).toBe(4100)
  })

  it('⑤-3 Node：脚本里的 `PORT=3005` 行内环境变量仍被识别（改造前能力）', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'web', scripts: { dev: 'PORT=3005 vite' } }),
    )

    expect(registry.scan(tempDir).detectedPort).toBe(3005)
  })

  it('⑤-4 Node：新增能力——.env 端口与框架默认端口兜底', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }),
    )
    // 无任何显式端口 → 框架默认 5173（低可信）
    expect(registry.scan(tempDir).detectedPort).toBe(5173)

    // .env 优先于框架默认
    writeFileSync(join(tempDir, '.env'), 'PORT=3010\n')
    expect(registry.scan(tempDir).detectedPort).toBe(3010)
  })

  it('⑤-5 Maven / Gradle：application.yml / properties 的 server.port 仍被识别', () => {
    const resources = join(tempDir, 'src', 'main', 'resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(tempDir, 'pom.xml'),
      `<?xml version="1.0"?><project><build><plugins><plugin>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin></plugins></build></project>`,
    )
    writeFileSync(join(resources, 'application.yml'), 'server:\n  port: 8082\n')
    expect(registry.scan(tempDir).detectedPort).toBe(8082)

    rmSync(join(tempDir, 'pom.xml'))
    rmSync(join(resources, 'application.yml'))
    writeFileSync(join(tempDir, 'build.gradle'), "plugins { id 'org.springframework.boot' }")
    writeFileSync(join(resources, 'application.properties'), 'server.port=8083\n')
    expect(registry.scan(tempDir).detectedPort).toBe(8083)
  })

  it('⑥ 未识别目录：返回 type=unknown', () => {
    // Empty directory, no project files
    const result = registry.scan(tempDir)
    expect(result.type).toBe('unknown')
    expect(result.recommendedCommand).toBe('')
    expect(result.recommendedArgs).toEqual([])
  })
})

// PX Dev — FrameworkDetector 单元测试
// 覆盖：vite / next / nuxt / react-scripts / @nestjs/core / express / spring-boot 七类固件
// 以及包管理器探测、structured 命令推荐、library 判定

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  detectJavaFramework,
  detectNodeFramework,
  detectPackageManager,
  pickDevScript,
  recommendGradleCommand,
  recommendMavenCommand,
  recommendNodeCommand,
} from '../src/main/detectors'

let tempDir: string

/** 写一个 package.json 固件目录并返回其绝对路径 */
function writePkg(name: string, pkg: Record<string, unknown>): string {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  return dir
}

/** 在目录内追加一个空文件 */
function touch(dir: string, file: string, content = ''): void {
  writeFileSync(join(dir, file), content)
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-framework-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('FrameworkDetector — 七类固件', () => {
  it('① vite（仅 vite 依赖，无前端框架）→ framework=vite / projectType=frontend', () => {
    const dir = writePkg('app-vite', {
      name: 'app-vite',
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^5.0.0' },
    })

    const result = detectNodeFramework(dir, {
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^5.0.0' },
    })

    expect(result.framework).toBe('vite')
    expect(result.projectType).toBe('frontend')
    expect(result.isLibrary).toBe(false)
  })

  it('② next → framework=next / projectType=frontend', () => {
    const pkg = { scripts: { dev: 'next dev' }, dependencies: { next: '^14.0.0', react: '^18' } }
    const dir = writePkg('app-next', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBe('next')
    expect(result.projectType).toBe('frontend')
  })

  it('③ nuxt → framework=nuxt / projectType=frontend', () => {
    const pkg = { scripts: { dev: 'nuxt dev' }, devDependencies: { nuxt: '^3.0.0' } }
    const dir = writePkg('app-nuxt', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBe('nuxt')
    expect(result.projectType).toBe('frontend')
  })

  it('④ react-scripts → framework=cra / projectType=frontend（不被通用 react 规则吃掉）', () => {
    const pkg = {
      scripts: { start: 'react-scripts start' },
      dependencies: { react: '^18.0.0' },
      devDependencies: { 'react-scripts': '^5.0.1' },
    }
    const dir = writePkg('app-cra', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBe('cra')
    expect(result.projectType).toBe('frontend')
  })

  it('⑤ @nestjs/core → framework=nest / projectType=node', () => {
    const pkg = {
      scripts: { start: 'nest start --watch' },
      dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' },
    }
    const dir = writePkg('app-nest', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBe('nest')
    expect(result.projectType).toBe('node')
  })

  it('⑥ express → framework=express / projectType=node', () => {
    const pkg = { scripts: { start: 'node server.js' }, dependencies: { express: '^4.19.0' } }
    const dir = writePkg('app-express', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBe('express')
    expect(result.projectType).toBe('node')
  })

  it('⑦ spring-boot（pom.xml）→ framework=spring-boot / projectType=java', () => {
    const dir = join(tempDir, 'app-boot')
    mkdirSync(dir, { recursive: true })
    touch(
      dir,
      'pom.xml',
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

    const result = detectJavaFramework(dir, 'maven')

    expect(result.framework).toBe('spring-boot')
    expect(result.projectType).toBe('java')
    expect(result.isLibrary).toBe(false)
  })
})

describe('FrameworkDetector — 优先级与边界', () => {
  it('⑧ vue + vite 同时存在 → frontend（而非 node）', () => {
    const pkg = {
      scripts: { dev: 'vite' },
      dependencies: { vue: '^3.4.0' },
      devDependencies: { vite: '^5.0.0' },
    }
    const dir = writePkg('app-vue', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBe('vue')
    expect(result.projectType).toBe('frontend')
  })

  it('⑨ 普通 Node 包（无任何框架特征）不会被误判为 frontend', () => {
    const pkg = { scripts: { start: 'node index.js' }, dependencies: { chalk: '^5' } }
    const dir = writePkg('app-plain', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.framework).toBeUndefined()
    expect(result.projectType).toBe('node')
  })

  it('⑩ 仅有 vite.config.ts、package.json 无依赖 → 靠配置文件命中 vite', () => {
    const dir = writePkg('app-config-only', { name: 'x', scripts: {} })
    touch(dir, 'vite.config.ts', 'export default {}')

    const result = detectNodeFramework(dir, { scripts: {} })

    expect(result.framework).toBe('vite')
    expect(result.projectType).toBe('frontend')
    expect(result.configFiles).toContain('vite.config.ts')
  })

  it('⑪ package.json 解析失败时保守判定为非 library（避免被静默过滤）', () => {
    const dir = join(tempDir, 'app-broken')
    mkdirSync(dir, { recursive: true })
    touch(dir, 'package.json', '{ broken json ')

    const result = detectNodeFramework(dir, undefined, true)

    expect(result.isLibrary).toBe(false)
  })

  it('⑫ 无 dev/start/serve 脚本且无运行时依赖 → isLibrary=true', () => {
    const pkg = { name: 'ui', scripts: { build: 'tsc' }, dependencies: { vue: '^3.4.0' } }
    const dir = writePkg('pkg-ui', pkg)

    const result = detectNodeFramework(dir, pkg)

    expect(result.isLibrary).toBe(true)
    // library 也应当给出框架判定，只是默认不生成 Service
    expect(result.framework).toBe('vue')
  })

  it('⑬ dev:* 脚本同样算可启动 → isLibrary=false', () => {
    const pkg = { name: 'ui', scripts: { 'dev:watch': 'tsc -w' } }
    const dir = writePkg('pkg-ui-watch', pkg)

    expect(detectNodeFramework(dir, pkg).isLibrary).toBe(false)
  })

  it('⑭ Maven <packaging>pom</packaging> 聚合工程 → isLibrary=true', () => {
    const dir = join(tempDir, 'agg')
    mkdirSync(dir, { recursive: true })
    touch(
      dir,
      'pom.xml',
      `<project><packaging>pom</packaging><modules><module>api</module></modules></project>`,
    )

    const result = detectJavaFramework(dir, 'maven')

    expect(result.isLibrary).toBe(true)
  })

  it('⑮ Gradle 无 org.springframework.boot 插件 → isLibrary=true', () => {
    const dir = join(tempDir, 'gradle-lib')
    mkdirSync(dir, { recursive: true })
    touch(dir, 'build.gradle', `plugins { id 'java-library' }`)

    const result = detectJavaFramework(dir, 'gradle')

    expect(result.framework).toBeUndefined()
    expect(result.isLibrary).toBe(true)
  })

  it('⑯ 单模块 Gradle 的 settings.gradle（无 include）不应被当作 monorepo 根', () => {
    const dir = join(tempDir, 'gradle-app')
    mkdirSync(dir, { recursive: true })
    touch(dir, 'build.gradle', `plugins { id 'org.springframework.boot' version '3.2.0' }`)
    touch(dir, 'settings.gradle', `rootProject.name = 'demo'`)

    const result = detectJavaFramework(dir, 'gradle')

    expect(result.framework).toBe('spring-boot')
    expect(result.isLibrary).toBe(false)
  })
})

describe('PackageManagerDetector', () => {
  it('⑰ lockfile 优先级：pnpm-lock > yarn.lock > bun.lockb > package-lock', () => {
    const dir = writePkg('pm-all', { name: 'pm' })
    touch(dir, 'package-lock.json', '{}')
    touch(dir, 'bun.lockb', '')
    expect(detectPackageManager(dir).packageManager).toBe('bun')

    touch(dir, 'yarn.lock', '')
    expect(detectPackageManager(dir).packageManager).toBe('yarn')

    touch(dir, 'pnpm-lock.yaml', '')
    expect(detectPackageManager(dir).packageManager).toBe('pnpm')
  })

  it('⑱ 无 lockfile 时读 packageManager 字段，再兜底 npm', () => {
    const dir = writePkg('pm-field', { name: 'pm' })

    expect(detectPackageManager(dir, { packageManager: 'pnpm@9.1.0' }).packageManager).toBe('pnpm')
    expect(detectPackageManager(dir, { packageManager: 'unknown@1' }).packageManager).toBe('npm')
    expect(detectPackageManager(dir).packageManager).toBe('npm')
  })

  it('⑲ 产出 evidence，便于 UI 展示判定依据', () => {
    const dir = writePkg('pm-evidence', { name: 'pm' })
    touch(dir, 'pnpm-lock.yaml', '')

    const result = detectPackageManager(dir)

    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0].source).toBe('pnpm-lock.yaml')
  })
})

describe('CommandRecommender — structured 输出', () => {
  it('⑳ 脚本优先级 dev > start > serve', () => {
    expect(pickDevScript({ serve: 'x', start: 'y', dev: 'z' })).toBe('dev')
    expect(pickDevScript({ serve: 'x', start: 'y' })).toBe('start')
    expect(pickDevScript({ serve: 'x' })).toBe('serve')
    expect(pickDevScript({})).toBeUndefined()
  })

  it('㉑ npm / pnpm / bun 走 run 前缀，yarn 不走', () => {
    const scripts = { dev: 'vite' }
    expect(recommendNodeCommand('npm', scripts)).toEqual({ command: 'npm', args: ['run', 'dev'] })
    expect(recommendNodeCommand('pnpm', scripts)).toEqual({ command: 'pnpm', args: ['run', 'dev'] })
    expect(recommendNodeCommand('bun', scripts)).toEqual({ command: 'bun', args: ['run', 'dev'] })
    expect(recommendNodeCommand('yarn', scripts)).toEqual({ command: 'yarn', args: ['dev'] })
  })

  it('㉒ 无启动脚本时回落为 install', () => {
    expect(recommendNodeCommand('npm', {})).toEqual({ command: 'npm', args: ['install'] })
  })

  it('㉓ Maven / Gradle wrapper 输出基名（由 buildCommand 负责 Windows 重映射）', () => {
    const plain = join(tempDir, 'plain')
    mkdirSync(plain, { recursive: true })
    expect(recommendMavenCommand(plain, true)).toEqual({
      command: 'mvn',
      args: ['spring-boot:run'],
    })
    expect(recommendGradleCommand(plain, true)).toEqual({ command: 'gradle', args: ['bootRun'] })

    const wrapped = join(tempDir, 'wrapped')
    mkdirSync(wrapped, { recursive: true })
    touch(wrapped, 'mvnw', '#!/bin/sh')
    touch(wrapped, 'gradlew.bat', '@echo off')
    expect(recommendMavenCommand(wrapped, true).command).toBe('mvnw')
    expect(recommendGradleCommand(wrapped, true).command).toBe('gradlew')

    // 非 Spring Boot 时的参数保持原有行为
    expect(recommendMavenCommand(plain, false).args).toEqual(['compile', 'exec:java'])
    expect(recommendGradleCommand(plain, false).args).toEqual(['run'])
  })
})

// PX Dev — 框架探测原语（纯函数）
//
// 唯一事实来源：三个 Scanner 委托本模块，discovery 侧不再另写一套判定。
//
// 判定输入按可信度从高到低分三轮：
//   1) dependencies / devDependencies / peerDependencies —— 最可靠
//   2) 框架配置文件名（vite.config.ts / nuxt.config.ts / angular.json ...）
//   3) scripts 内容里的命令 token（"dev": "vite --port 3000"）
// 三轮都按同一份**有序**规则表匹配，因此「vue/react + vite」必然落在 frontend，
// 「仅 express/koa/fastify/nest」必然落在 node。
//
// 注意：本模块**不解析端口**（端口统一留给 Phase 4 的 PortDetector），
// 也不生成命令（命令由 CommandRecommender 负责）。

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { DetectionEvidence, DiscoveryProjectType } from '@shared/types'
import { detectMonorepoRoot } from '../discovery/utils/monorepo'

/** package.json 中与框架判定相关的最小形状 */
export interface FrameworkAwarePackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: unknown
  private?: boolean
}

/** 框架探测结果 */
export interface FrameworkDetection {
  /** 框架标识，如 'vite' | 'next' | 'nest' | 'spring-boot'；无法判定时为 undefined */
  framework?: string
  projectType: DiscoveryProjectType
  /** monorepo library / 不可独立运行的模块：默认不生成 Service */
  isLibrary: boolean
  /** 命中的配置文件名（相对目录，仅文件名） */
  configFiles: string[]
  evidence: DetectionEvidence[]
}

/** 单条框架识别规则 */
interface FrameworkRule {
  framework: string
  projectType: 'frontend' | 'node'
  /** 依赖名；以 '/' 结尾表示 scope 前缀匹配（如 '@midwayjs/'） */
  deps?: string[]
  /** 框架配置文件名 */
  configFiles?: string[]
  /** scripts 内容中的命令 token */
  scriptTokens?: RegExp[]
}

/**
 * 框架识别规则表，**数组顺序即优先级**。
 *
 * 顺序设计：
 * - 前端元框架 / UI 框架在前 → 保证 `vue + vite` 判成 frontend 而非 node
 * - 服务端框架居中 → 保证「仅 express/koa/fastify/nest」判成 node
 * - 纯构建工具（vite / webpack）垫底 → 只有在没有任何框架特征时才作为 frontend 兜底
 */
const FRAMEWORK_RULES: readonly FrameworkRule[] = [
  // —— 前端元框架 ——
  {
    framework: 'next',
    projectType: 'frontend',
    deps: ['next'],
    configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    scriptTokens: [/\bnext\s+(dev|start|build)\b/],
  },
  {
    framework: 'nuxt',
    projectType: 'frontend',
    deps: ['nuxt', 'nuxt3'],
    configFiles: ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'],
    scriptTokens: [/\bnuxt\b/],
  },
  {
    framework: 'angular',
    projectType: 'frontend',
    deps: ['@angular/core', '@angular/cli'],
    configFiles: ['angular.json'],
    scriptTokens: [/\bng\s+serve\b/],
  },
  {
    framework: 'astro',
    projectType: 'frontend',
    deps: ['astro'],
    configFiles: ['astro.config.mjs', 'astro.config.ts'],
    scriptTokens: [/\bastro\s+dev\b/],
  },
  // —— 脚手架型前端（先于通用 react/vue，避免被通用规则吃掉）——
  {
    framework: 'cra',
    projectType: 'frontend',
    deps: ['react-scripts'],
    scriptTokens: [/\breact-scripts\b/],
  },
  {
    framework: 'vue-cli',
    projectType: 'frontend',
    deps: ['@vue/cli-service'],
    configFiles: ['vue.config.js', 'vue.config.ts'],
    scriptTokens: [/\bvue-cli-service\b/],
  },
  {
    framework: 'svelte',
    projectType: 'frontend',
    deps: ['svelte', '@sveltejs/kit'],
    configFiles: ['svelte.config.js'],
    scriptTokens: [/\bsvelte-kit\b/],
  },
  // —— 通用前端 UI 框架 ——
  { framework: 'vue', projectType: 'frontend', deps: ['vue'] },
  { framework: 'react', projectType: 'frontend', deps: ['react'] },
  { framework: 'solid', projectType: 'frontend', deps: ['solid-js'] },
  // —— 服务端框架 ——
  {
    framework: 'nest',
    projectType: 'node',
    deps: ['@nestjs/core'],
    configFiles: ['nest-cli.json'],
    scriptTokens: [/\bnest\s+(start|build)\b/],
  },
  { framework: 'midway', projectType: 'node', deps: ['@midwayjs/'] },
  { framework: 'express', projectType: 'node', deps: ['express'] },
  { framework: 'koa', projectType: 'node', deps: ['koa'] },
  { framework: 'fastify', projectType: 'node', deps: ['fastify'] },
  { framework: 'hono', projectType: 'node', deps: ['hono'] },
  // —— 构建工具兜底（无任何框架特征时才生效）——
  {
    framework: 'vite',
    projectType: 'frontend',
    deps: ['vite'],
    configFiles: ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'],
    scriptTokens: [/\bvite\b/],
  },
  {
    framework: 'webpack',
    projectType: 'frontend',
    deps: ['webpack-dev-server'],
    configFiles: ['webpack.config.js', 'webpack.config.ts'],
    scriptTokens: [/\bwebpack(-dev-server)?\b/],
  },
]

/** 服务端框架依赖：出现即说明模块可独立运行（library 判定用） */
const SERVER_FRAMEWORK_DEPS: readonly string[] = [
  'express',
  'koa',
  'fastify',
  '@nestjs/core',
  'next',
  'nuxt',
  '@midwayjs/',
]

/** 前端 dev-server 依赖：出现即说明模块可独立起本地服务（library 判定用） */
const DEV_SERVER_DEPS: readonly string[] = [
  'vite',
  'webpack-dev-server',
  '@angular/cli',
  'react-scripts',
]

/** 可视为「可启动」的脚本名 */
const RUNNABLE_SCRIPTS: readonly string[] = ['dev', 'start', 'serve']

/** 合并 dependencies / devDependencies / peerDependencies 的键集合 */
export function collectDependencyNames(pkg?: FrameworkAwarePackageJson): string[] {
  return [
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
    ...Object.keys(pkg?.peerDependencies ?? {}),
  ]
}

/** 依赖是否命中（'@scope/' 结尾按前缀匹配，其余精确匹配） */
function matchDependency(names: string[], pattern: string): boolean {
  if (pattern.endsWith('/')) return names.some((name) => name.startsWith(pattern))
  return names.includes(pattern)
}

/** 目录内存在的文件名列表（只判存在，不读内容） */
function existingFiles(dirPath: string, files: readonly string[]): string[] {
  const found: string[] = []
  for (const file of files) {
    try {
      if (existsSync(join(dirPath, file))) found.push(file)
    } catch {
      // 权限 / 长路径异常：跳过该文件
    }
  }
  return found
}

/** 是否存在 dev / start / serve / dev:* 脚本 */
export function hasRunnableScript(scripts: Record<string, string> = {}): boolean {
  const names = Object.keys(scripts)
  if (names.some((name) => RUNNABLE_SCRIPTS.includes(name))) return true
  return names.some((name) => name.startsWith('dev:'))
}

/**
 * 探测 Node 项目的框架 / 项目类型 / library 属性。
 *
 * @param dirPath     目录绝对路径
 * @param pkg         已解析的 package.json（解析失败时传 undefined）
 * @param parseFailed package.json 解析失败标记；为 true 时**保守判定为非 library**，
 *                    避免把「读不出信息」的项目静默过滤掉
 */
export function detectNodeFramework(
  dirPath: string,
  pkg?: FrameworkAwarePackageJson,
  parseFailed = false,
): FrameworkDetection {
  const deps = collectDependencyNames(pkg)
  const scripts = pkg?.scripts ?? {}
  const scriptText = Object.values(scripts).join('\n')
  const evidence: DetectionEvidence[] = []
  const configFiles: string[] = []

  let framework: string | undefined
  let projectType: DiscoveryProjectType = 'node'

  // 第 1 轮：依赖（最可靠）
  for (const rule of FRAMEWORK_RULES) {
    const hit = rule.deps?.find((dep) => matchDependency(deps, dep))
    if (!hit) continue
    framework = rule.framework
    projectType = rule.projectType
    evidence.push({
      type: 'dependency',
      detail: `依赖 ${hit} 命中框架 ${rule.framework}`,
      source: 'package.json',
    })
    break
  }

  // 第 2 轮：框架配置文件名
  if (!framework) {
    for (const rule of FRAMEWORK_RULES) {
      const hit = existingFiles(dirPath, rule.configFiles ?? [])[0]
      if (!hit) continue
      framework = rule.framework
      projectType = rule.projectType
      evidence.push({
        type: 'config-file',
        detail: `配置文件 ${hit} 命中框架 ${rule.framework}`,
        source: hit,
      })
      break
    }
  }

  // 第 3 轮：scripts 内容里的命令 token
  if (!framework && scriptText !== '') {
    for (const rule of FRAMEWORK_RULES) {
      const hit = rule.scriptTokens?.find((token) => token.test(scriptText))
      if (!hit) continue
      framework = rule.framework
      projectType = rule.projectType
      evidence.push({
        type: 'script',
        detail: `scripts 中出现 ${rule.framework} 命令，判定框架为 ${rule.framework}`,
        source: 'package.json',
      })
      break
    }
  }

  // 收集所有实际存在的框架配置文件（供 UI 展示证据，不影响判定结果）
  for (const rule of FRAMEWORK_RULES) {
    for (const file of existingFiles(dirPath, rule.configFiles ?? [])) {
      if (!configFiles.includes(file)) configFiles.push(file)
    }
  }

  const { isLibrary, libraryEvidence } = resolveNodeLibrary(dirPath, pkg, deps, parseFailed)
  evidence.push(...libraryEvidence)

  return { framework, projectType, isLibrary, configFiles, evidence }
}

/**
 * Node library 判定：
 *   isLibrary = 无 (dev|start|serve|dev:*) 脚本
 *            && 无服务端框架依赖
 *            && 无前端 dev-server 依赖
 * monorepo 根（workspaces / pnpm-workspace.yaml / lerna.json）强制为 library。
 */
function resolveNodeLibrary(
  dirPath: string,
  pkg: FrameworkAwarePackageJson | undefined,
  deps: string[],
  parseFailed: boolean,
): { isLibrary: boolean; libraryEvidence: DetectionEvidence[] } {
  const libraryEvidence: DetectionEvidence[] = []

  const monorepo = detectMonorepoRoot(dirPath, pkg)
  if (monorepo.isRoot) {
    libraryEvidence.push({
      type: 'monorepo-root',
      detail: `命中 monorepo 根标记（${monorepo.markers.join(', ')}），默认不生成 Service`,
      source: monorepo.markers[0] ?? 'package.json',
    })
    return { isLibrary: true, libraryEvidence }
  }

  // package.json 解析失败：信息不足，保守视为可运行项目，交给用户判断
  if (parseFailed) {
    libraryEvidence.push({
      type: 'heuristic',
      detail: 'package.json 解析失败，无法判定 library，保守视为可运行项目',
      source: 'package.json',
    })
    return { isLibrary: false, libraryEvidence }
  }

  const runnable = hasRunnableScript(pkg?.scripts)
  const serverDep = SERVER_FRAMEWORK_DEPS.find((dep) => matchDependency(deps, dep))
  const devServerDep = DEV_SERVER_DEPS.find((dep) => matchDependency(deps, dep))
  const isLibrary = !runnable && !serverDep && !devServerDep

  libraryEvidence.push(
    isLibrary
      ? {
          type: 'library',
          detail: '无 dev/start/serve 脚本，且无服务端框架与前端 dev-server 依赖，判定为 library',
          source: 'package.json',
        }
      : {
          type: 'runnable',
          detail: runnable
            ? '存在可启动脚本（dev/start/serve），判定为可运行项目'
            : `存在可运行依赖 ${serverDep ?? devServerDep}，判定为可运行项目`,
          source: 'package.json',
        },
  )

  return { isLibrary, libraryEvidence }
}

/** Maven / Gradle 两种 Java 构建方式 */
export type JavaBuildKind = 'maven' | 'gradle'

/** Gradle 构建脚本候选文件 */
const GRADLE_BUILD_FILES: readonly string[] = ['build.gradle', 'build.gradle.kts']

/**
 * 探测 Java 项目的框架 / library 属性。
 *
 * Maven：isLibrary = <packaging>pom</packaging> 或 缺少 spring-boot-starter-web / spring-boot-maven-plugin
 * Gradle：isLibrary = 缺少 org.springframework.boot 插件
 */
export function detectJavaFramework(dirPath: string, kind: JavaBuildKind): FrameworkDetection {
  const evidence: DetectionEvidence[] = []
  const configFiles: string[] = []

  const buildFiles = kind === 'maven' ? ['pom.xml'] : GRADLE_BUILD_FILES
  let content = ''
  for (const file of existingFiles(dirPath, buildFiles)) {
    configFiles.push(file)
    try {
      content += `${readFileSync(join(dirPath, file), 'utf-8')}\n`
    } catch {
      // 构建脚本读取失败：按「无 Spring Boot 特征」处理
    }
  }

  const isSpringBoot = hasSpringBoot(content, kind)
  const framework = isSpringBoot ? 'spring-boot' : undefined
  if (isSpringBoot) {
    evidence.push({
      type: 'dependency',
      detail: `${kind === 'maven' ? 'pom.xml' : 'build.gradle'} 含 Spring Boot 依赖 / 插件`,
      source: configFiles[0] ?? (kind === 'maven' ? 'pom.xml' : 'build.gradle'),
    })
  }

  const monorepo = detectMonorepoRoot(dirPath)
  let isLibrary: boolean
  if (monorepo.isRoot) {
    isLibrary = true
    evidence.push({
      type: 'monorepo-root',
      detail: `命中多模块根标记（${monorepo.markers.join(', ')}），默认不生成 Service`,
      source: monorepo.markers[0] ?? configFiles[0] ?? 'pom.xml',
    })
  } else if (kind === 'maven') {
    isLibrary = !(
      content.includes('spring-boot-starter-web') || content.includes('spring-boot-maven-plugin')
    )
    evidence.push({
      type: isLibrary ? 'library' : 'runnable',
      detail: isLibrary
        ? '缺少 spring-boot-starter-web / spring-boot-maven-plugin，判定为不可独立启动的模块'
        : '含 spring-boot-starter-web / spring-boot-maven-plugin，判定为可运行应用',
      source: 'pom.xml',
    })
  } else {
    isLibrary = !isSpringBoot
    evidence.push({
      type: isLibrary ? 'library' : 'runnable',
      detail: isLibrary
        ? '缺少 org.springframework.boot 插件，判定为不可独立启动的模块'
        : '含 org.springframework.boot 插件，判定为可运行应用',
      source: configFiles[0] ?? 'build.gradle',
    })
  }

  return { framework, projectType: 'java', isLibrary, configFiles, evidence }
}

/** 构建脚本内容是否含 Spring Boot 特征 */
export function hasSpringBoot(content: string, kind: JavaBuildKind): boolean {
  if (content === '') return false
  if (kind === 'maven') {
    return (
      content.includes('spring-boot-starter') ||
      content.includes('spring-boot-maven-plugin') ||
      content.includes('org.springframework.boot')
    )
  }
  return (
    content.includes('org.springframework.boot') || content.includes('spring-boot-gradle-plugin')
  )
}

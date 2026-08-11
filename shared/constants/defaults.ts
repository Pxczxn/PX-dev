// PX Dev — Default Config / Settings

import type { AppConfig, Settings } from '../types'

export const CURRENT_CONFIG_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  closeBehavior: 'tray',
  maxLogLines: 5000,
  startMinimized: false,
  autoRestoreLastSession: false,
  startupInterval: 1000,
  showTimestamp: true,
  defaultBrowser: 'system',
}

export const DEFAULT_CONFIG: AppConfig = {
  version: CURRENT_CONFIG_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  workspaces: [],
  services: [],
}

// ============ 框架默认端口表（Phase 4 静态端口推断的兜底来源） ============
//
// 仅作为**最低可信度**的兜底：PortDetector 命中该表时一律产出 confidence='low'，
// UI 需标灰并提示「推测端口」，绝不能与 command/config/env 的实测值同权。
// 键与 FrameworkDetector 的 framework 标识保持一致。
export const FRAMEWORK_DEFAULT_PORTS: Record<string, number> = {
  // —— 前端 ——
  vite: 5173,
  vue: 5173,
  react: 5173,
  solid: 3000,
  svelte: 5173,
  astro: 4321,
  next: 3000,
  nuxt: 3000,
  cra: 3000,
  'vue-cli': 8080,
  angular: 4200,
  webpack: 8080,
  // —— 服务端 ——
  nest: 3000,
  express: 3000,
  koa: 3000,
  fastify: 3000,
  hono: 3000,
  midway: 7001,
  'spring-boot': 8080,
}

// ============ Common port presets ============
/** 数据库 / 中间件等与框架无关的常用端口 */
const INFRA_COMMON_PORTS = [3001, 4000, 5174, 8081, 8888, 3306, 6379, 27017]

/** 端口占用巡检用的常用端口集合 = 框架默认端口 ∪ 基础设施端口，升序去重 */
export const COMMON_PORTS: readonly number[] = [
  ...new Set([...Object.values(FRAMEWORK_DEFAULT_PORTS), ...INFRA_COMMON_PORTS]),
].sort((a, b) => a - b)

// ============ Windows command remapping ============
export const WINDOWS_CMD_REMAP: Record<string, string> = {
  npm: 'npm.cmd',
  pnpm: 'pnpm.cmd',
  yarn: 'yarn.cmd',
  bun: 'bun.exe',
  npx: 'npx.cmd',
  tsx: 'tsx.cmd',
  // Java 系构建工具：Windows 下同样是批处理包装脚本，
  // Maven 发行版提供 mvn.cmd / mvnw.cmd，Gradle 发行版提供 gradle.bat / gradlew.bat
  mvn: 'mvn.cmd',
  mvnw: 'mvnw.cmd',
  gradle: 'gradle.bat',
  gradlew: 'gradlew.bat',
}

export const ENVIRONMENT_COMMANDS = {
  node: 'node',
  npm: 'npm',
  pnpm: 'pnpm',
  yarn: 'yarn',
  java: 'java',
  mvn: 'mvn',
  gradle: 'gradle',
  git: 'git',
} as const

export const ENVIRONMENT_VERSION_ARGS = {
  node: ['--version'],
  npm: ['--version'],
  pnpm: ['--version'],
  yarn: ['--version'],
  java: ['-version'],
  mvn: ['--version'],
  gradle: ['--version'],
  git: ['--version'],
} as const

// PX Dev — Monorepo 根判定工具（纯函数）
//
// 职责：只回答「这个目录是不是一个 monorepo 根」，不做任何框架 / 命令推断。
// 被 src/main/detectors/FrameworkDetector 复用，本文件不反向依赖 detectors，避免循环。
//
// 判定依据（命中任意一条即为 monorepo 根）：
// - package.json 存在 `workspaces` 字段（npm / yarn / bun workspaces）
// - pnpm-workspace.yaml（pnpm workspaces）
// - lerna.json（Lerna）
// - settings.gradle / settings.gradle.kts（Gradle 多模块）
// - pom.xml 含 <modules>（Maven 聚合工程）

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** 文件形式的 monorepo 根标记（存在即命中） */
export const MONOREPO_MARKER_FILES: readonly string[] = [
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
  'lerna.json',
]

/**
 * Gradle 多模块标记文件。
 *
 * 注意：`settings.gradle` 在**单模块** Gradle 工程里同样普遍存在（只写 rootProject.name），
 * 因此不能「存在即判定为 monorepo 根」，必须确认其中出现了 `include` 语句，
 * 否则会把绝大多数普通 Gradle 应用误判为 library 而被过滤掉。
 */
const GRADLE_SETTINGS_FILES: readonly string[] = ['settings.gradle', 'settings.gradle.kts']

/** settings.gradle 是否声明了子模块（含 include 语句） */
export function isGradleMultiModule(settingsContent: string): boolean {
  return /^\s*include\s*[( '"]/m.test(settingsContent)
}

/** monorepo 根判定结果 */
export interface MonorepoRootInfo {
  /** 是否为 monorepo 根 */
  isRoot: boolean
  /** 命中的标记（文件名，或 'package.json#workspaces' / 'pom.xml#modules' 这类字段标记） */
  markers: string[]
}

/** package.json 中与 monorepo 判定相关的最小形状 */
interface WorkspaceAwarePackageJson {
  workspaces?: unknown
}

/** package.json 是否声明了 workspaces（数组或 { packages: [] } 两种写法都算） */
export function hasWorkspacesField(pkg: unknown): boolean {
  const workspaces = (pkg as WorkspaceAwarePackageJson | undefined)?.workspaces
  if (Array.isArray(workspaces)) return workspaces.length > 0
  if (workspaces && typeof workspaces === 'object') {
    const packages = (workspaces as { packages?: unknown }).packages
    return Array.isArray(packages) && packages.length > 0
  }
  return false
}

/** pom.xml 是否是聚合工程（含 <modules> 或 <packaging>pom</packaging>） */
export function isMavenAggregator(pomContent: string): boolean {
  return /<modules\s*>/.test(pomContent) || /<packaging>\s*pom\s*<\/packaging>/.test(pomContent)
}

/**
 * 判定目录是否为 monorepo 根。
 *
 * @param dirPath 目录绝对路径
 * @param pkg     已解析的 package.json（可选，传入可避免重复读盘）
 */
export function detectMonorepoRoot(dirPath: string, pkg?: unknown): MonorepoRootInfo {
  const markers: string[] = []

  if (hasWorkspacesField(pkg)) {
    markers.push('package.json#workspaces')
  }

  for (const file of MONOREPO_MARKER_FILES) {
    try {
      if (existsSync(join(dirPath, file))) markers.push(file)
    } catch {
      // 权限 / 长路径异常：跳过该文件的判定，不影响整体
    }
  }

  // Gradle 多模块：settings.gradle 内出现 include
  for (const file of GRADLE_SETTINGS_FILES) {
    const settingsPath = join(dirPath, file)
    try {
      if (existsSync(settingsPath) && isGradleMultiModule(readFileSync(settingsPath, 'utf-8'))) {
        markers.push(`${file}#include`)
      }
    } catch {
      // settings.gradle 读取失败时不做多模块判定
    }
  }

  // Maven 聚合工程：<modules> 或 <packaging>pom</packaging>
  const pomPath = join(dirPath, 'pom.xml')
  try {
    if (existsSync(pomPath) && isMavenAggregator(readFileSync(pomPath, 'utf-8'))) {
      markers.push('pom.xml#modules')
    }
  } catch {
    // pom.xml 读取失败时不做聚合工程判定
  }

  return { isRoot: markers.length > 0, markers }
}

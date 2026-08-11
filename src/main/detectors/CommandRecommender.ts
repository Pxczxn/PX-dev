// PX Dev — 启动命令推荐原语（纯函数）
//
// 只产出 structured 形式 `{ command, args[] }`，**禁止拼接成一整条字符串**。
//
// 两条硬约束：
// 1. command 一律是**基名**（npm / pnpm / yarn / bun / mvn / mvnw / gradle / gradlew），
//    Windows 下的 `.cmd` / `.bat` 重映射由运行时 `buildCommand → resolveExecutable`
//    配合 `WINDOWS_CMD_REMAP` 完成；这里若输出 `./mvnw` 反而会**绕过**重映射表。
// 2. 不解析参数中的端口（端口统一由 Phase 4 的 PortDetector 负责，避免逻辑落两处）。

import { existsSync } from 'fs'
import { join } from 'path'
import type { PackageManagerId } from './PackageManagerDetector'

/** structured 命令推荐结果 */
export interface CommandRecommendation {
  /** 可执行文件基名，不含参数、不含 ./ 前缀 */
  command: string
  /** 参数数组 */
  args: string[]
}

/** 脚本优先级：dev > start > serve（沿用 NodeProjectScanner 原有语义） */
export const DEV_SCRIPT_PRIORITY: readonly string[] = ['dev', 'start', 'serve']

/** 按 dev > start > serve 选出启动脚本名；都不存在返回 undefined */
export function pickDevScript(scripts: Record<string, string> = {}): string | undefined {
  return DEV_SCRIPT_PRIORITY.find((name) => Boolean(scripts[name]))
}

/**
 * Node 项目命令推荐。
 *
 * | 包管理器 | 脚本 dev | 结果            |
 * |----------|----------|-----------------|
 * | npm      | dev      | npm run dev     |
 * | pnpm     | dev      | pnpm run dev    |
 * | yarn     | dev      | yarn dev        |
 * | bun      | dev      | bun run dev     |
 *
 * 无任何启动脚本时回落为 `<pm> install`（沿用原 Scanner 行为）。
 */
export function recommendNodeCommand(
  packageManager: PackageManagerId | string,
  scripts: Record<string, string> = {},
): CommandRecommendation {
  const devScript = pickDevScript(scripts)

  if (!devScript) {
    return { command: packageManager, args: ['install'] }
  }

  // yarn 的脚本无需 run 前缀（`yarn dev` 即可），其余包管理器统一用 run
  if (packageManager === 'yarn') {
    return { command: 'yarn', args: [devScript] }
  }

  return { command: packageManager, args: ['run', devScript] }
}

/** Maven wrapper 是否存在（mvnw 或 mvnw.cmd 任一即可） */
export function hasMavenWrapper(dirPath: string): boolean {
  return existsAny(dirPath, ['mvnw', 'mvnw.cmd'])
}

/** Gradle wrapper 是否存在（gradlew 或 gradlew.bat 任一即可） */
export function hasGradleWrapper(dirPath: string): boolean {
  return existsAny(dirPath, ['gradlew', 'gradlew.bat'])
}

/**
 * Maven 命令推荐。
 * wrapper 存在 → `mvnw`，否则 `mvn`；Spring Boot → `spring-boot:run`，否则 `compile exec:java`。
 */
export function recommendMavenCommand(
  dirPath: string,
  isSpringBoot: boolean,
): CommandRecommendation {
  return {
    command: hasMavenWrapper(dirPath) ? 'mvnw' : 'mvn',
    args: isSpringBoot ? ['spring-boot:run'] : ['compile', 'exec:java'],
  }
}

/**
 * Gradle 命令推荐。
 * wrapper 存在 → `gradlew`，否则 `gradle`；Spring Boot → `bootRun`，否则 `run`。
 */
export function recommendGradleCommand(
  dirPath: string,
  isSpringBoot: boolean,
): CommandRecommendation {
  return {
    command: hasGradleWrapper(dirPath) ? 'gradlew' : 'gradle',
    args: isSpringBoot ? ['bootRun'] : ['run'],
  }
}

/** 目录内是否存在任一给定文件（吞掉权限 / 长路径异常） */
function existsAny(dirPath: string, files: readonly string[]): boolean {
  for (const file of files) {
    try {
      if (existsSync(join(dirPath, file))) return true
    } catch {
      // 单个文件判定异常时继续判断下一个
    }
  }
  return false
}

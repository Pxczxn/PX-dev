// PX Dev — 项目标记文件常量 + ScanResult.type → DiscoveryProjectType 映射

import { existsSync } from 'fs'
import { join } from 'path'
import type { DiscoveredProject, ScanResult } from '@shared/types'

/**
 * 项目标记文件清单。
 * 只要目录内存在其中任意一个，就视为「候选目录」，交给 ScannerRegistry 做进一步识别。
 */
export const PROJECT_MARKER_FILES: string[] = [
  // Node
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'package-lock.json',
  // Maven
  'pom.xml',
  'mvnw',
  'mvnw.cmd',
  // Gradle
  'build.gradle',
  'build.gradle.kts',
  'gradlew',
  'gradlew.bat',
]

/**
 * 「主标记文件」：出现这些文件说明目录几乎必然是一个真实项目根，
 * 而 lockfile / wrapper 脚本单独出现时可信度较低（可能只是残留）。
 */
export const PRIMARY_MARKER_FILES: string[] = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
]

/**
 * 列出目录内命中的项目标记文件名。
 * 任何 fs 异常都被吞掉并返回已收集到的部分，保证遍历不中断。
 */
export function findMarkerFiles(dirPath: string): string[] {
  const found: string[] = []
  for (const file of PROJECT_MARKER_FILES) {
    try {
      if (existsSync(join(dirPath, file))) found.push(file)
    } catch {
      // 权限 / 长路径异常：跳过该文件的判定
    }
  }
  return found
}

/** 目录是否为候选目录（含任一项目标记文件） */
export function isCandidateDir(dirPath: string): boolean {
  for (const file of PROJECT_MARKER_FILES) {
    try {
      if (existsSync(join(dirPath, file))) return true
    } catch {
      // 同上，忽略单个文件的判定异常
    }
  }
  return false
}

/**
 * ScanResult.type → DiscoveredProject.projectType。
 *
 * Phase 1 采用保守映射：node → 'node'、maven/gradle → 'java'、unknown → 'unknown'。
 * Phase 2 引入框架检测后，含 vue / react / vite 等前端特征的 node 项目会被精化为 'frontend'，
 * 届时只需修改本函数（或新增带框架入参的重载），不影响调用方。
 */
export function mapScanTypeToProjectType(
  scanType: ScanResult['type'],
): DiscoveredProject['projectType'] {
  switch (scanType) {
    case 'node':
      return 'node'
    case 'maven':
    case 'gradle':
      return 'java'
    default:
      return 'unknown'
  }
}

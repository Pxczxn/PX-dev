// PX Dev — 包管理器探测原语（纯函数）
//
// 唯一事实来源：NodeProjectScanner 委托本模块，discovery 侧不再另写一套判定。
// 优先级：lockfile（pnpm > yarn > bun > npm）→ package.json#packageManager → 默认 npm。

import { existsSync } from 'fs'
import { join } from 'path'
import type { DetectionEvidence } from '@shared/types'

/** 支持的 Node 包管理器 */
export type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** 全部合法包管理器标识（用于校验 package.json#packageManager 字段） */
export const PACKAGE_MANAGER_IDS: readonly PackageManagerId[] = ['npm', 'pnpm', 'yarn', 'bun']

/**
 * lockfile → 包管理器映射，**数组顺序即优先级**。
 * 与设计文档一致：pnpm-lock.yaml > yarn.lock > bun.lockb > package-lock.json。
 */
const LOCKFILE_PRIORITY: ReadonlyArray<{ file: string; pm: PackageManagerId }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'bun.lock', pm: 'bun' },
  { file: 'package-lock.json', pm: 'npm' },
]

/** package.json 中与包管理器判定相关的最小形状 */
export interface PackageManagerAwarePackageJson {
  packageManager?: string
}

/** 探测结果 */
export interface PackageManagerDetection {
  packageManager: PackageManagerId
  /** 命中的 lockfile 文件名（未命中 lockfile 时为空数组） */
  lockFiles: string[]
  evidence: DetectionEvidence[]
}

/** 目录内存在的 lockfile 列表（按优先级顺序） */
export function findLockFiles(dirPath: string): string[] {
  const found: string[] = []
  for (const { file } of LOCKFILE_PRIORITY) {
    try {
      if (existsSync(join(dirPath, file))) found.push(file)
    } catch {
      // 权限 / 长路径异常：跳过该 lockfile 判定
    }
  }
  return found
}

/**
 * 探测目录使用的包管理器。
 *
 * @param dirPath 目录绝对路径
 * @param pkg     已解析的 package.json（可选，传入可避免重复读盘）
 */
export function detectPackageManager(
  dirPath: string,
  pkg?: PackageManagerAwarePackageJson,
): PackageManagerDetection {
  const lockFiles = findLockFiles(dirPath)
  const evidence: DetectionEvidence[] = []

  // 1) lockfile 优先
  for (const { file, pm } of LOCKFILE_PRIORITY) {
    if (!lockFiles.includes(file)) continue
    evidence.push({
      type: 'lockfile',
      detail: `发现 ${file}，判定包管理器为 ${pm}`,
      source: file,
    })
    return { packageManager: pm, lockFiles, evidence }
  }

  // 2) package.json#packageManager（corepack 规范，形如 "pnpm@9.1.0"）
  const declared = normalizePackageManagerField(pkg?.packageManager)
  if (declared) {
    evidence.push({
      type: 'config-field',
      detail: `package.json#packageManager 声明为 ${declared}`,
      source: 'package.json',
    })
    return { packageManager: declared, lockFiles, evidence }
  }

  // 3) 兜底 npm
  evidence.push({
    type: 'heuristic',
    detail: '未发现 lockfile 与 packageManager 字段，回落到默认包管理器 npm',
    source: 'package.json',
  })
  return { packageManager: 'npm', lockFiles, evidence }
}

/** 解析 corepack 风格的 packageManager 字段（"pnpm@9.1.0" → "pnpm"），非法值返回 undefined */
export function normalizePackageManagerField(value?: string): PackageManagerId | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const name = value.split('@')[0]?.trim().toLowerCase()
  return PACKAGE_MANAGER_IDS.find((pm) => pm === name)
}

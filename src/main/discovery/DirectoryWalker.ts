// PX Dev — 目录遍历器（BFS 层序遍历）
//
// 职责边界：**只产出候选目录列表**，不 import 任何 scanner、不做任何项目识别。
// 深度约定：root 自身 depth=0；maxDepth=3 表示最深访问到 root/a/b/c。
//
// 稳健性要求（Phase 1 验收项）：
// - 忽略清单目录不进入队列
// - 不跟随符号链接，跳过并记 DISCOVERY_SYMLINK_SKIPPED
// - 超过 maxDirectories / timeout 立即停止，返回部分结果并标记 truncated
// - 单目录 readdir 失败（权限、Windows ENAMETOOLONG 长路径）降级为 warning，不中断整体

import { lstatSync, readdirSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { join, relative, resolve, sep } from 'path'
import type {
  DirectoryWalkResult,
  DiscoveryWarning,
  DiscoveryWarningCode,
  WorkspaceDiscoveryOptions,
} from '@shared/types'
import { DISCOVERY_DEFAULTS } from '@shared/schemas/discovery.schema'
import { isIgnored } from './utils/ignoredPaths'
import { isCandidateDir } from './utils/projectTypeMap'

// 供测试与 Manager 复用的纯函数（统一从 walker 出口暴露）
export { isIgnored } from './utils/ignoredPaths'
export { isCandidateDir } from './utils/projectTypeMap'

/**
 * 带错误码的发现异常。
 * 定义在 main 侧但**不依赖 electron**，上层 IPC handler 可直接转成 IpcError。
 */
export class DiscoveryError extends Error {
  code: DiscoveryWarningCode

  constructor(code: DiscoveryWarningCode, message: string) {
    super(message)
    this.code = code
    this.name = 'DiscoveryError'
  }
}

/** BFS 队列元素 */
interface QueueItem {
  path: string
  depth: number
}

export class DirectoryWalker {
  /**
   * 从 rootPath 出发做 BFS 层序遍历，收集候选目录。
   * @throws DiscoveryError root 不存在（DISCOVERY_ROOT_NOT_FOUND）或不是目录（DISCOVERY_ROOT_NOT_DIRECTORY）
   */
  walk(rootPath: string, options?: WorkspaceDiscoveryOptions): DirectoryWalkResult {
    const startedAt = Date.now()
    const root = resolve(rootPath)
    const maxDepth = options?.maxDepth ?? DISCOVERY_DEFAULTS.maxDepth
    const maxDirectories = options?.maxDirectories ?? DISCOVERY_DEFAULTS.maxDirectories
    const timeout = options?.timeout ?? DISCOVERY_DEFAULTS.timeout
    const extraIgnores = options?.extraIgnores

    this.assertRootUsable(root)

    const candidates: string[] = []
    const warnings: DiscoveryWarning[] = []
    let scannedDirectories = 0
    let skippedDirectories = 0
    let maxDepthReached = 0
    let truncated = false

    const queue: QueueItem[] = [{ path: root, depth: 0 }]

    while (queue.length > 0) {
      // —— 超时：停止遍历，返回已收集的部分结果 ——
      if (Date.now() - startedAt > timeout) {
        truncated = true
        warnings.push({
          code: 'DISCOVERY_TIMEOUT',
          message: `扫描超时（${timeout}ms），已返回部分结果`,
          path: this.toRelative(root, root),
          severity: 'warn',
        })
        break
      }

      // —— 目录数限额：停止遍历 ——
      if (scannedDirectories >= maxDirectories) {
        truncated = true
        warnings.push({
          code: 'DISCOVERY_DIRECTORY_LIMIT',
          message: `已达到目录数上限（${maxDirectories}），遍历被截断`,
          path: this.toRelative(root, root),
          severity: 'warn',
        })
        break
      }

      const current = queue.shift() as QueueItem
      scannedDirectories += 1
      if (current.depth > maxDepthReached) maxDepthReached = current.depth

      // 候选目录判定：含任一项目标记文件
      if (isCandidateDir(current.path)) {
        candidates.push(current.path)
      }

      // 已到最大深度，不再展开下一层
      if (current.depth >= maxDepth) continue

      const entries = this.readDirSafe(current.path, root, warnings)
      if (entries === null) continue

      for (const entry of entries) {
        const childPath = join(current.path, entry.name)

        // 先判忽略清单：node_modules 之类即便是符号链接也静默跳过，避免刷屏 warning
        if (isIgnored(entry.name, extraIgnores)) {
          skippedDirectories += 1
          continue
        }

        const kind = this.classifyEntry(childPath, entry)
        if (kind === 'symlink') {
          skippedDirectories += 1
          warnings.push({
            code: 'DISCOVERY_SYMLINK_SKIPPED',
            message: `跳过符号链接：${entry.name}`,
            path: this.toRelative(root, childPath),
            severity: 'info',
          })
          continue
        }
        if (kind !== 'dir') continue

        queue.push({ path: childPath, depth: current.depth + 1 })
      }
    }

    return {
      candidates,
      warnings,
      stats: {
        scannedDirectories,
        maxDepthReached,
        truncated,
        elapsedMs: Date.now() - startedAt,
        skippedDirectories,
      },
    }
  }

  /** 校验 root 可用；不可用直接抛 DiscoveryError（由上层转 IpcError） */
  private assertRootUsable(root: string): void {
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(root)
    } catch {
      throw new DiscoveryError('DISCOVERY_ROOT_NOT_FOUND', `扫描根目录不存在：${root}`)
    }
    if (!stat.isDirectory()) {
      throw new DiscoveryError('DISCOVERY_ROOT_NOT_DIRECTORY', `扫描根路径不是目录：${root}`)
    }
  }

  /**
   * 读取目录项；失败时记 warning 并返回 null（调用方跳过该目录，继续遍历）。
   * 覆盖 EACCES/EPERM（无权限）与 ENAMETOOLONG（Windows 长路径）等场景。
   */
  private readDirSafe(
    dirPath: string,
    root: string,
    warnings: DiscoveryWarning[],
  ): Dirent[] | null {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      const denied = code === 'EACCES' || code === 'EPERM'
      warnings.push({
        code: denied ? 'DISCOVERY_PERMISSION_DENIED' : 'DISCOVERY_READ_FAILED',
        message: denied
          ? `目录无读取权限，已跳过（${code}）`
          : `目录读取失败，已跳过（${code ?? 'UNKNOWN'}）`,
        path: this.toRelative(root, dirPath),
        severity: 'warn',
      })
      return null
    }
  }

  /**
   * 判定目录项类型。
   * 优先使用 readdir(withFileTypes) 的 Dirent（其语义等价于 lstat，不跟随链接）；
   * 类型未知时回落到 lstatSync 兜底，仍然保证不跟随符号链接。
   */
  private classifyEntry(childPath: string, entry: Dirent): 'dir' | 'symlink' | 'other' {
    if (entry.isSymbolicLink()) return 'symlink'
    if (entry.isDirectory()) return 'dir'
    if (entry.isFile()) return 'other'
    try {
      const st = lstatSync(childPath)
      if (st.isSymbolicLink()) return 'symlink'
      return st.isDirectory() ? 'dir' : 'other'
    } catch {
      return 'other'
    }
  }

  /** 绝对路径 → 相对 root 的路径；root 自身为 '.'，分隔符统一为 '/' */
  private toRelative(root: string, target: string): string {
    const rel = relative(root, target)
    if (rel === '' || rel === '.') return '.'
    return rel.split(sep).join('/')
  }
}

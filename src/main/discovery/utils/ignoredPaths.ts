// PX Dev — 遍历忽略清单
//
// 这些目录在递归发现时直接跳过：要么体量巨大（node_modules），
// 要么是构建产物（dist / build / out / target），要么是工具目录（.git / .idea）。

/** 默认忽略的目录名（大小写不敏感比较） */
export const IGNORED_DIRS: string[] = [
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'release',
  '.next',
  '.nuxt',
  '.cache',
  '.tmp',
  'logs',
]

/** 预建 Set，避免每个目录项都做一次线性查找 */
const IGNORED_SET = new Set(IGNORED_DIRS.map((n) => n.toLowerCase()))

/**
 * 判断某个目录名是否命中忽略清单。
 * @param name 目录名（不是完整路径）
 * @param extraIgnores 调用方追加的忽略名，与默认清单合并
 */
export function isIgnored(name: string, extraIgnores?: string[]): boolean {
  const lower = name.toLowerCase()
  if (IGNORED_SET.has(lower)) return true
  if (extraIgnores && extraIgnores.length > 0) {
    return extraIgnores.some((n) => n.toLowerCase() === lower)
  }
  return false
}

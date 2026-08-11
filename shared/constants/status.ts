// PX Dev — Status Constants
// Process status enum + colors + Chinese labels

import type { ProcessStatus } from '../types'

export const STATUS_CONFIG: Record<
  ProcessStatus,
  {
    color: string
    label: string
    tagType: 'default' | 'info' | 'success' | 'warning' | 'error'
  }
> = {
  stopped: { color: '#8a90a2', label: '已停止', tagType: 'default' },
  starting: { color: '#2b8cff', label: '启动中', tagType: 'info' },
  running: { color: '#2bc16b', label: '运行中', tagType: 'success' },
  stopping: { color: '#f5a524', label: '停止中', tagType: 'warning' },
  exited: { color: '#8a90a2', label: '已退出', tagType: 'default' },
  failed: { color: '#f2545b', label: '失败', tagType: 'error' },
  unknown: { color: '#8a90a2', label: '未知', tagType: 'default' },
} as const

// ============ Valid State Transitions ============
export const VALID_TRANSITIONS: Record<ProcessStatus, ProcessStatus[]> = {
  stopped: ['starting', 'unknown'],
  starting: ['running', 'failed', 'stopping'],
  running: ['stopping', 'exited', 'failed', 'starting'],
  stopping: ['stopped'],
  exited: ['stopped', 'starting'],
  failed: ['stopped', 'starting'],
  unknown: ['stopped', 'starting'],
}

// ============ Error Codes ============
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CWD_NOT_FOUND: 'CWD_NOT_FOUND',
  PORT_CONFLICT: 'PORT_CONFLICT',
  PROCESS_RUNNING: 'PROCESS_RUNNING',
  PROCESS_NOT_FOUND: 'PROCESS_NOT_FOUND',
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  CONFIG_CORRUPTED: 'CONFIG_CORRUPTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // ---- Workspace Discovery（与 DiscoveryWarningCode 一一对应）----
  /** 扫描根目录不存在 */
  DISCOVERY_ROOT_NOT_FOUND: 'DISCOVERY_ROOT_NOT_FOUND',
  /** 扫描根路径存在但不是目录 */
  DISCOVERY_ROOT_NOT_DIRECTORY: 'DISCOVERY_ROOT_NOT_DIRECTORY',
  /** 目录无读取权限（EACCES / EPERM） */
  DISCOVERY_PERMISSION_DENIED: 'DISCOVERY_PERMISSION_DENIED',
  /** 目录读取失败（含 Windows ENAMETOOLONG 长路径） */
  DISCOVERY_READ_FAILED: 'DISCOVERY_READ_FAILED',
  /** 达到 maxDepth，更深层未遍历 */
  DISCOVERY_DEPTH_LIMIT: 'DISCOVERY_DEPTH_LIMIT',
  /** 达到 maxDirectories，遍历被截断 */
  DISCOVERY_DIRECTORY_LIMIT: 'DISCOVERY_DIRECTORY_LIMIT',
  /** 遍历超时，返回部分结果 */
  DISCOVERY_TIMEOUT: 'DISCOVERY_TIMEOUT',
  /** 符号链接被跳过（不跟随） */
  DISCOVERY_SYMLINK_SKIPPED: 'DISCOVERY_SYMLINK_SKIPPED',
  /** 项目配置文件解析失败（如 package.json 非法 JSON） */
  DISCOVERY_PARSE_FAILED: 'DISCOVERY_PARSE_FAILED',
  /** 单个目录的扫描器执行抛错 */
  DISCOVERY_SCANNER_FAILED: 'DISCOVERY_SCANNER_FAILED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

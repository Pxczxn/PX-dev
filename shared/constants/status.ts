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
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

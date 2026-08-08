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

// ============ Common port presets ============
export const COMMON_PORTS = [
  3000,
  3001,
  4000,
  5173,
  5174,
  8080,
  8081,
  8888,
  3306,
  6379,
  27017,
] as const

// ============ Windows command remapping ============
export const WINDOWS_CMD_REMAP: Record<string, string> = {
  npm: 'npm.cmd',
  pnpm: 'pnpm.cmd',
  yarn: 'yarn.cmd',
  bun: 'bun.exe',
  npx: 'npx.cmd',
  tsx: 'tsx.cmd',
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

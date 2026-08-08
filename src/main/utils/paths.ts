// PX Dev — Path Utilities
// Centralized path resolution for config, logs, resources

import { app } from 'electron'
import { join, resolve } from 'path'

/**
 * Get the user data directory for PX Dev.
 * Uses Electron's app.getPath('userData') in production.
 */
export function getConfigDir(): string {
  return app.getPath('userData')
}

/** config.json full path */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/** config.json.bak full path */
export function getBakPath(): string {
  return join(getConfigDir(), 'config.json.bak')
}

/** config.json.tmp full path (for atomic writes) */
export function getTmpPath(): string {
  return join(getConfigDir(), 'config.json.tmp')
}

/** logs directory */
export function getLogDir(): string {
  return join(getConfigDir(), 'logs')
}

/** resources directory (for tray icon, etc.) */
export function getResourcesDir(): string {
  return join(app.getAppPath(), 'resources')
}

/**
 * Resolve a path to absolute, ensuring it's normalized.
 * Used before passing cwd to spawn().
 */
export function resolveAbsolutePath(p: string): string {
  return resolve(p)
}

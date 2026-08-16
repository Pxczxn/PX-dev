import { isTauri as checkTauri } from '@tauri-apps/api/core'
import type { PlatformInfo } from './types'

/**
 * 检测当前运行平台
 * 使用官方 @tauri-apps/api/core 的 isTauri() 检测 Tauri
 * 优先检测 Electron（避免 @tauri-apps/api 在 Electron 中的副作用）
 */
export function detectPlatform(): PlatformInfo {
  // Electron 优先检测（window.pxDev 由 contextBridge 暴露）
  if (typeof window !== 'undefined' && 'pxDev' in window) {
    return { platform: 'electron' }
  }

  // 使用官方 isTauri() API
  if (checkTauri()) {
    return { platform: 'tauri' }
  }

  // 默认 Web/未知
  return { platform: 'web' }
}

export function isElectron(): boolean {
  return detectPlatform().platform === 'electron'
}

export function isTauri(): boolean {
  return detectPlatform().platform === 'tauri'
}

export function isWeb(): boolean {
  return detectPlatform().platform === 'web'
}

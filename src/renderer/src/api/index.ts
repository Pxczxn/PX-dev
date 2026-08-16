// PX Dev — Renderer API Layer
// Phase 1: Platform-aware API with Electron/Tauri adapters

import { detectPlatform } from '@renderer/platform/detect'
import { createElectronAdapter, createTauriAdapter } from './platform'
import type { PxDevClient } from '@shared/types/client'

// API 实例缓存
let apiInstance: PxDevClient | null = null

/**
 * 获取平台适配的 API 实例
 * Electron: 包装 window.pxDev，应用 toPlain 序列化
 * Tauri: invoke Rust commands，未实现方法抛出 NotImplementedError
 * 
 * 返回完整 PxDevClient 接口（非 Partial），迁移状态不污染类型系统
 */
function getApi(): PxDevClient {
  if (apiInstance) return apiInstance

  const { platform } = detectPlatform()

  if (platform === 'electron') {
    apiInstance = createElectronAdapter()
  } else if (platform === 'tauri') {
    apiInstance = createTauriAdapter()
  } else {
    throw new Error('API not available in web environment')
  }

  return apiInstance
}

export const api = {
  get workspace() {
    return getApi().workspace
  },
  get service() {
    return getApi().service
  },
  get process() {
    return getApi().process
  },
  get log() {
    return getApi().log
  },
  get environment() {
    return getApi().environment
  },
  get port() {
    return getApi().port
  },
  get system() {
    return getApi().system
  },
  get app() {
    return getApi().app
  },
  get events() {
    return getApi().events
  },
}

// Re-export utilities
export { toPlain } from './serialize'
export { formatIpcError } from './errors'

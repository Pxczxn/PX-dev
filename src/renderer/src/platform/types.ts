export type Platform = 'electron' | 'tauri' | 'web'

export interface PlatformInfo {
  platform: Platform
  version?: string
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTauriAdapter } from '@renderer/api/platform/tauri'
import { NotImplementedError } from '@renderer/api/platform/types'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('Tauri Adapter - App Commands (Phase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('app.getSettings', () => {
    it('calls get_settings command', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockSettings = {
        theme: 'dark',
        closeBehavior: 'tray',
        maxLogLines: 5000,
        startMinimized: false,
        autoRestoreLastSession: false,
        startupInterval: 1000,
        showTimestamp: true,
        defaultBrowser: 'system',
      }
      vi.mocked(invoke).mockResolvedValue(mockSettings)

      const adapter = createTauriAdapter()
      const result = await adapter.app.getSettings()

      expect(invoke).toHaveBeenCalledWith('get_settings')
      expect(result).toEqual(mockSettings)
    })
  })

  describe('app.updateSettings', () => {
    it('calls update_settings command with input', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const input = { theme: 'light', maxLogLines: 10000 }
      const updatedSettings = {
        theme: 'light',
        closeBehavior: 'tray',
        maxLogLines: 10000,
        startMinimized: false,
        autoRestoreLastSession: false,
        startupInterval: 1000,
        showTimestamp: true,
        defaultBrowser: 'system',
      }
      vi.mocked(invoke).mockResolvedValue(updatedSettings)

      const adapter = createTauriAdapter()
      const result = await adapter.app.updateSettings(input)

      expect(invoke).toHaveBeenCalledWith('update_settings', { input })
      expect(result).toEqual(updatedSettings)
    })
  })

  describe('app.getVersion', () => {
    it('calls get_app_version command', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('0.1.0')

      const adapter = createTauriAdapter()
      const result = await adapter.app.getVersion()

      expect(invoke).toHaveBeenCalledWith('get_app_version')
      expect(result).toBe('0.1.0')
    })
  })

  describe('app - unimplemented methods', () => {
    it('throws NotImplementedError for quit', () => {
      const adapter = createTauriAdapter()
      expect(() => adapter.app.quit()).toThrow(NotImplementedError)
      expect(() => adapter.app.quit()).toThrow('app.quit is not implemented')
    })

    it('throws NotImplementedError for minimize', () => {
      const adapter = createTauriAdapter()
      expect(() => adapter.app.minimize()).toThrow(NotImplementedError)
      expect(() => adapter.app.minimize()).toThrow('app.minimize is not implemented')
    })

    it('throws NotImplementedError for getDataPath', () => {
      const adapter = createTauriAdapter()
      expect(() => adapter.app.getDataPath()).toThrow(NotImplementedError)
      expect(() => adapter.app.getDataPath()).toThrow('app.getDataPath is not implemented')
    })

    it('throws NotImplementedError for selectDataPath', () => {
      const adapter = createTauriAdapter()
      expect(() => adapter.app.selectDataPath()).toThrow(NotImplementedError)
      expect(() => adapter.app.selectDataPath()).toThrow('app.selectDataPath is not implemented')
    })
  })

  describe('Phase 1 commands still work', () => {
    it('system.ping still works', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('PX Dev Tauri backend ready')

      const adapter = createTauriAdapter()
      const result = await adapter.system.ping()

      expect(invoke).toHaveBeenCalledWith('px_ping')
      expect(result).toBe('PX Dev Tauri backend ready')
    })
  })
})

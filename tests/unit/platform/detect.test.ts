import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { detectPlatform, isElectron, isTauri, isWeb } from '@renderer/platform/detect'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(),
}))

describe('Platform Detection', () => {
  let originalWindow: Window & typeof globalThis
  
  beforeEach(async () => {
    originalWindow = global.window
  })

  afterEach(() => {
    global.window = originalWindow
    vi.clearAllMocks()
  })

  it('detects Electron when window.pxDev is present', async () => {
    // Mock window with pxDev
    global.window = { pxDev: {} } as Window & typeof globalThis & { pxDev: unknown }
    
    const { isTauri: checkTauri } = await import('@tauri-apps/api/core')
    vi.mocked(checkTauri).mockReturnValue(false)

    expect(detectPlatform().platform).toBe('electron')
    expect(isElectron()).toBe(true)
    expect(isTauri()).toBe(false)
    expect(isWeb()).toBe(false)
  })

  it('detects Tauri when isTauri() returns true', async () => {
    // Mock window without pxDev
    global.window = {} as Window & typeof globalThis
    
    const { isTauri: checkTauri } = await import('@tauri-apps/api/core')
    vi.mocked(checkTauri).mockReturnValue(true)

    expect(detectPlatform().platform).toBe('tauri')
    expect(isTauri()).toBe(true)
    expect(isElectron()).toBe(false)
    expect(isWeb()).toBe(false)
  })

  it('detects web when neither Electron nor Tauri', async () => {
    // Mock window without pxDev
    global.window = {} as Window & typeof globalThis
    
    const { isTauri: checkTauri } = await import('@tauri-apps/api/core')
    vi.mocked(checkTauri).mockReturnValue(false)

    expect(detectPlatform().platform).toBe('web')
    expect(isWeb()).toBe(true)
    expect(isElectron()).toBe(false)
    expect(isTauri()).toBe(false)
  })

  it('prioritizes Electron over Tauri when both are present', async () => {
    // Mock window with pxDev
    global.window = { pxDev: {} } as Window & typeof globalThis & { pxDev: unknown }
    
    const { isTauri: checkTauri } = await import('@tauri-apps/api/core')
    vi.mocked(checkTauri).mockReturnValue(true)

    expect(detectPlatform().platform).toBe('electron')
    expect(isElectron()).toBe(true)
  })
})

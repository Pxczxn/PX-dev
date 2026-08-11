// PX Dev — ConfigManager Unit Tests
// Covers: first launch, normal save, JSON corruption, .bak recovery, version migration

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigManager } from '../src/main/managers/ConfigManager'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_CONFIG, CURRENT_CONFIG_VERSION } from '../shared/constants/defaults'
import type { AppConfig } from '../shared/types'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ConfigManager', () => {
  it('① 首次启动：config.json 不存在时创建默认配置', () => {
    const cm = new ConfigManager(tempDir)
    const config = cm.get()

    expect(config.version).toBe(CURRENT_CONFIG_VERSION)
    expect(config.workspaces).toEqual([])
    expect(config.services).toEqual([])
    expect(config.settings.maxLogLines).toBe(5000)
    expect(config.settings.theme).toBe('dark')

    // config.json should have been created
    const configPath = join(tempDir, 'config.json')
    expect(existsSync(configPath)).toBe(true)
  })

  it('② 正常保存：写入 config.json.tmp → rename → config.json', () => {
    const cm = new ConfigManager(tempDir)
    const config = cm.get()

    config.workspaces.push({
      id: 'ws-1',
      name: 'Test Workspace',
      favorite: false,
      startMode: 'parallel',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    cm.save(config)

    // Re-read and verify
    const raw = readFileSync(join(tempDir, 'config.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.workspaces).toHaveLength(1)
    expect(parsed.workspaces[0].name).toBe('Test Workspace')

    // tmp file should not exist after rename
    expect(existsSync(join(tempDir, 'config.json.tmp'))).toBe(false)
  })

  it('③ JSON 损坏：自动尝试从 .bak 恢复', () => {
    // First, create a valid config with a workspace
    const cm1 = new ConfigManager(tempDir)
    const config = cm1.get()
    config.workspaces.push({
      id: 'ws-bak',
      name: 'Backup Test',
      favorite: true,
      startMode: 'sequential',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
    cm1.save(config)

    // Save again — this backs up the config-with-workspace to .bak
    // (save() always backs up the PREVIOUS config.json before writing new one)
    cm1.save(config)

    // Now corrupt config.json
    writeFileSync(join(tempDir, 'config.json'), '{ "corrupted": true, }}}}', 'utf-8')

    // Load should recover from .bak (which has the workspace)
    const cm2 = new ConfigManager(tempDir)
    const recovered = cm2.get()

    expect(recovered.workspaces).toHaveLength(1)
    expect(recovered.workspaces[0].id).toBe('ws-bak')
    expect(recovered.workspaces[0].name).toBe('Backup Test')
  })

  it('④ .bak 也损坏：创建默认配置', () => {
    // Write corrupt config.json and corrupt .bak
    writeFileSync(join(tempDir, 'config.json'), '{ "broken": }}}', 'utf-8')
    writeFileSync(join(tempDir, 'config.json.bak'), '{ "also-broken": }}}', 'utf-8')

    const cm = new ConfigManager(tempDir)
    const config = cm.get()

    expect(config.version).toBe(CURRENT_CONFIG_VERSION)
    expect(config.workspaces).toEqual([])
    expect(config.services).toEqual([])

    // config.json should now be valid default
    const raw = readFileSync(join(tempDir, 'config.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(CURRENT_CONFIG_VERSION)
  })

  it('⑤ 版本迁移：旧版本 config 自动迁移到当前版本', () => {
    // Write a config with version=0 (simulating old version)
    const oldConfig: AppConfig = {
      version: 0,
      settings: DEFAULT_CONFIG.settings,
      workspaces: [
        {
          id: 'ws-old',
          name: 'Old Workspace',
          favorite: false,
          startMode: 'parallel',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      services: [],
    }

    writeFileSync(join(tempDir, 'config.json'), JSON.stringify(oldConfig), 'utf-8')

    const cm = new ConfigManager(tempDir)
    const config = cm.get()

    expect(config.version).toBe(CURRENT_CONFIG_VERSION)
    expect(config.workspaces).toHaveLength(1)
    expect(config.workspaces[0].name).toBe('Old Workspace')
  })
})

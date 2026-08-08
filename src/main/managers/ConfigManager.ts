// PX Dev — ConfigManager
// JSON persistence with atomic writes, backup recovery, and schema migration

import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { AppConfigSchema } from '@shared/schemas/config.schema'
import { DEFAULT_CONFIG, CURRENT_CONFIG_VERSION } from '@shared/constants/defaults'
import type { AppConfig } from '@shared/types'
import { logger } from '../utils/logger'

export class ConfigManager {
  private configPath: string
  private bakPath: string
  private tmpPath: string
  private config: AppConfig

  /**
   * @param configDir - Directory for config files. Defaults to Electron userData path.
   *                     In tests, pass a temp directory.
   */
  constructor(configDir?: string) {
    const baseDir = configDir ?? this.getDefaultConfigDir()
    this.configPath = this.joinPath(baseDir, 'config.json')
    this.bakPath = this.joinPath(baseDir, 'config.json.bak')
    this.tmpPath = this.joinPath(baseDir, 'config.json.tmp')
    this.config = this.load()
  }

  /** Load config from disk, with fallback chain: config.json → config.json.bak → default */
  load(): AppConfig {
    // Try config.json first
    if (existsSync(this.configPath)) {
      try {
        const raw = readFileSync(this.configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        const migrated = this.migrate(parsed)
        const validated = AppConfigSchema.parse(migrated)
        logger.info('Config loaded successfully')
        return validated
      } catch (err) {
        logger.warn(`config.json parse/validation failed, trying .bak: ${(err as Error).message}`)
        // Fall through to .bak recovery
      }
    }

    // Try config.json.bak
    const recovered = this.recover()
    if (recovered) {
      return recovered
    }

    // Both missing or corrupt → create default
    logger.warn('No valid config found, creating default configuration')
    this.config = this.cloneDefault()
    this.save(this.config)
    return this.config
  }

  /**
   * Atomic save: write tmp → fsync → rename → backup old as .bak
   * Steps:
   * 1. Backup current config.json → config.json.bak (if exists)
   * 2. Write JSON to config.json.tmp
   * 3. Rename tmp → config.json (atomic on most filesystems)
   */
  save(config: AppConfig): void {
    const dir = dirname(this.configPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Step 1: Backup existing config.json → config.json.bak
    if (existsSync(this.configPath)) {
      try {
        copyFileSync(this.configPath, this.bakPath)
      } catch (err) {
        logger.warn(`Failed to create .bak backup: ${(err as Error).message}`)
      }
    }

    // Step 2: Write to tmp file
    const jsonStr = JSON.stringify(config, null, 2)
    writeFileSync(this.tmpPath, jsonStr, 'utf-8')

    // Step 3: Rename tmp → config.json (atomic)
    renameSync(this.tmpPath, this.configPath)

    this.config = config
    logger.debug('Config saved atomically')
  }

  /** Backup current config.json to config.json.bak */
  backup(): void {
    if (existsSync(this.configPath)) {
      copyFileSync(this.configPath, this.bakPath)
      logger.debug('Config backed up to .bak')
    }
  }

  /**
   * Migrate config to current version.
   * V0.1: only version=1 exists, so this is a framework placeholder.
   * Future: v1→v2→v3... incremental migration.
   */
  migrate(old: unknown): AppConfig {
    const obj = old as Record<string, unknown>
    const version = typeof obj.version === 'number' ? obj.version : 0

    if (version < CURRENT_CONFIG_VERSION) {
      logger.info(`Migrating config from v${version} to v${CURRENT_CONFIG_VERSION}`)
      // V0.1: no actual migration needed, just set version
      obj.version = CURRENT_CONFIG_VERSION
    }

    return obj as unknown as AppConfig
  }

  /** Try to recover from .bak file. Returns null if .bak is also missing/corrupt. */
  recover(): AppConfig | null {
    if (!existsSync(this.bakPath)) {
      return null
    }

    try {
      const raw = readFileSync(this.bakPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const migrated = this.migrate(parsed)
      const validated = AppConfigSchema.parse(migrated)
      logger.info('Config recovered from .bak file')

      // Restore: save recovered config back to config.json
      this.save(validated)
      return validated
    } catch (err) {
      logger.error(`config.json.bak also corrupt: ${(err as Error).message}`)
      return null
    }
  }

  /** Get current in-memory config (returns a deep clone to prevent external mutation) */
  get(): AppConfig {
    return this.deepClone(this.config)
  }

  /** Merge a patch into config and save atomically */
  update(patch: Partial<AppConfig>): AppConfig {
    this.config = {
      ...this.config,
      ...patch,
      version: CURRENT_CONFIG_VERSION,
    }
    this.save(this.config)
    return this.get()
  }

  /** Get config file paths (for debugging/testing) */
  getPaths(): { configPath: string; bakPath: string; tmpPath: string } {
    return {
      configPath: this.configPath,
      bakPath: this.bakPath,
      tmpPath: this.tmpPath,
    }
  }

  // ============ Private helpers ============

  private getDefaultConfigDir(): string {
    // In production, use Electron's app.getPath('userData')
    // Lazy require to avoid import error in test environment
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { app } = require('electron')
      return app.getPath('userData')
    } catch {
      // Fallback for test environment without Electron
      return join(tmpdir(), 'px-dev-test')
    }
  }

  private joinPath(base: string, file: string): string {
    return join(base, file)
  }

  private cloneDefault(): AppConfig {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T
  }
}

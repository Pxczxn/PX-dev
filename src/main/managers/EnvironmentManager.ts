// PX Dev — EnvironmentManager
// Detects node/npm/pnpm/yarn/java/mvn/gradle/git versions

import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import type { EnvironmentInfo, EnvironmentName } from '@shared/types'
import { ENVIRONMENT_COMMANDS, ENVIRONMENT_VERSION_ARGS } from '@shared/constants/defaults'
import { WINDOWS_CMD_REMAP } from '@shared/constants/defaults'
import { logger } from '../utils/logger'

const execFileAsync = promisify(execFile)

const ALL_ENVIRONMENTS: EnvironmentName[] = [
  'node',
  'npm',
  'pnpm',
  'yarn',
  'java',
  'mvn',
  'gradle',
  'git',
]

export class EnvironmentManager {
  private cache: Map<EnvironmentName, EnvironmentInfo> = new Map()

  /** Detect all 8 environments in parallel */
  async detectAll(): Promise<EnvironmentInfo[]> {
    const results = await Promise.all(
      ALL_ENVIRONMENTS.map((name) => this.detect(name)),
    )
    return results
  }

  /** Detect a single environment by name */
  async detect(name: EnvironmentName): Promise<EnvironmentInfo> {
    // Return cached if available
    const cached = this.cache.get(name)
    if (cached) {
      return cached
    }

    const info = await this.checkCommand(name)
    this.cache.set(name, info)
    return info
  }

  /** Clear cache, forcing re-detection on next call */
  clearCache(): void {
    this.cache.clear()
  }

  /** Check a single command and return EnvironmentInfo */
  private async checkCommand(name: EnvironmentName): Promise<EnvironmentInfo> {
    const command = this.resolveCommand(name)
    const args = ENVIRONMENT_VERSION_ARGS[name] ?? ['--version']

    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: 10000,
        windowsHide: true,
      })

      // Some commands output version to stderr (e.g., java -version)
      const output = (stdout || stderr).trim()
      const version = this.parseVersion(output, name)
      const path = await this.getCommandPath(command)

      return {
        name,
        available: true,
        version,
        path,
      }
    } catch (err) {
      const errorMsg = (err as Error).message
      logger.debug(`Environment check failed for ${name}: ${errorMsg}`)
      return {
        name,
        available: false,
        version: '',
        path: '',
        error: `command not found: ${command}`,
      }
    }
  }

  /** Resolve command name with Windows .cmd remapping */
  private resolveCommand(name: EnvironmentName): string {
    const cmd = ENVIRONMENT_COMMANDS[name] ?? name
    if (process.platform === 'win32') {
      const lower = cmd.toLowerCase()
      const remapped = WINDOWS_CMD_REMAP[lower]
      if (remapped) {
        return remapped
      }
    }
    return cmd
  }

  /** Get the full path of a command using 'which' (Unix) or 'where' (Windows) */
  private async getCommandPath(command: string): Promise<string> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync('where', [command.replace(/\.cmd$/i, '')], {
          timeout: 5000,
          windowsHide: true,
        })
        return stdout.trim().split('\n')[0].trim()
      } else {
        const { stdout } = await execFileAsync('which', [command], {
          timeout: 5000,
        })
        return stdout.trim()
      }
    } catch {
      return ''
    }
  }

  /** Parse version string from command output */
  private parseVersion(output: string, name: EnvironmentName): string {
    const firstLine = output.split('\n')[0].trim()

    switch (name) {
      case 'node':
        // v24.0.0 → v24.0.0
        return firstLine
      case 'java': {
        // openjdk version "17.0.1" → 17.0.1
        const javaMatch = firstLine.match(/version\s+"([^"]+)"/)
        return javaMatch ? javaMatch[1] : firstLine
      }
      default:
        // npm: 10.8.0, pnpm: 9.4.0, etc.
        return firstLine
    }
  }

  /** Generate a unique ID (utility method) */
  generateId(): string {
    return randomUUID()
  }
}

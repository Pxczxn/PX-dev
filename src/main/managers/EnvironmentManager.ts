// PX Dev — EnvironmentManager
// Detects node/npm/pnpm/yarn/java/mvn/gradle/git versions

import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import type { EnvironmentInfo, EnvironmentName } from '@shared/types'
import { ENVIRONMENT_COMMANDS, ENVIRONMENT_VERSION_ARGS } from '@shared/constants/defaults'
import { isWindowsBatchScript, quoteForCmd, resolveExecutable } from '../utils/command'
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

  /**
   * Detect a single environment by name
   *
   * @param name     环境名
   * @param platform 目标平台，默认当前平台（显式传入便于跨平台单测）
   */
  async detect(
    name: EnvironmentName,
    platform: NodeJS.Platform = process.platform,
  ): Promise<EnvironmentInfo> {
    // Return cached if available
    const cached = this.cache.get(name)
    if (cached) {
      return cached
    }

    const info = await this.checkCommand(name, platform)
    this.cache.set(name, info)
    return info
  }

  /** Clear cache, forcing re-detection on next call */
  clearCache(): void {
    this.cache.clear()
  }

  /** Check a single command and return EnvironmentInfo */
  private async checkCommand(
    name: EnvironmentName,
    platform: NodeJS.Platform = process.platform,
  ): Promise<EnvironmentInfo> {
    const command = this.resolveCommand(name, platform)
    const versionArgs: readonly string[] = ENVIRONMENT_VERSION_ARGS[name] ?? ['--version']

    // Windows 下 npm / mvn / gradle 等重映射结果是 .cmd / .bat 批处理脚本。
    // 自 Node 18.20.2 / 20.12.2 起（CVE-2024-27980 缓解措施），shell:false 时
    // 执行批处理脚本会直接抛 `spawn EINVAL`，导致这些环境恒被误判为「未安装」。
    // 因此批处理脚本必须切换到 shell:true；其余命令保持原有 execFile 路径。
    const useShell = isWindowsBatchScript(command, platform)

    // 与 buildCommand 保持一致：shell:true 时 Node 只是把 [file, ...args] 用空格拼接
    // 后交给 cmd.exe，且**不做任何转义**（Node 22+ 为此新增 DEP0190 弃用告警）。
    // 所以这里自行用 quoteForCmd 拼好整行命令，args 传空数组，语义等价且不触发告警。
    const file = useShell
      ? [quoteForCmd(command), ...versionArgs.map(quoteForCmd)].join(' ')
      : command
    const args = useShell ? [] : versionArgs

    try {
      const { stdout, stderr } = await execFileAsync(file, args, {
        timeout: 10000,
        windowsHide: true,
        shell: useShell,
      })

      // Some commands output version to stderr (e.g., java -version)
      const output = (stdout || stderr).trim()
      const version = this.parseVersion(output, name)
      const path = await this.getCommandPath(command, platform)

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

  /**
   * Resolve command name with Windows .cmd remapping
   *
   * 重映射逻辑统一复用 command.ts 的 resolveExecutable，
   * 避免在此维护第二套与 CommandBuilder 可能不一致的映射表。
   */
  private resolveCommand(
    name: EnvironmentName,
    platform: NodeJS.Platform = process.platform,
  ): string {
    const cmd = ENVIRONMENT_COMMANDS[name] ?? name
    return resolveExecutable(cmd, platform)
  }

  /** Get the full path of a command using 'which' (Unix) or 'where' (Windows) */
  private async getCommandPath(
    command: string,
    platform: NodeJS.Platform = process.platform,
  ): Promise<string> {
    try {
      if (platform === 'win32') {
        // where 只识别裸命令名：resolveExecutable 已把 npm → npm.cmd、gradle → gradle.bat，
        // 必须同时剥掉 .cmd 与 .bat 后缀，否则 `where npm.cmd` / `where gradle.bat` 查不到。
        const { stdout } = await execFileAsync('where', [command.replace(/\.(cmd|bat)$/i, '')], {
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

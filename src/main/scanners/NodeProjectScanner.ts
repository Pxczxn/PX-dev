// PX Dev — Node Project Scanner
// Reads package.json, detects lock files, identifies package manager, parses scripts

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ScanResult } from '@shared/types'
import type { ProjectScanner } from './index'

interface PackageJson {
  name?: string
  version?: string
  scripts?: Record<string, string>
  packageManager?: string
}

export class NodeProjectScanner implements ProjectScanner {
  /** Check if directory contains a package.json */
  canHandle(dirPath: string): boolean {
    return existsSync(join(dirPath, 'package.json'))
  }

  scan(dirPath: string): ScanResult {
    const pkg = this.readPackageJson(dirPath)
    const packageManager = this.detectPackageManager(dirPath, pkg)
    const scripts = pkg.scripts ?? {}
    const detectedPort = this.detectPort(dirPath, scripts)
    const { command, args } = this.recommendCommand(packageManager, scripts)

    return {
      path: dirPath,
      type: 'node',
      packageManager,
      recommendedCommand: command,
      recommendedArgs: args,
      scripts,
      detectedPort,
    }
  }

  /** Read and parse package.json */
  private readPackageJson(dirPath: string): PackageJson {
    try {
      const raw = readFileSync(join(dirPath, 'package.json'), 'utf-8')
      return JSON.parse(raw) as PackageJson
    } catch {
      return {}
    }
  }

  /**
   * Detect package manager based on lock files and packageManager field.
   * Priority: pnpm-lock.yaml > yarn.lock > package-lock.json > packageManager field > default npm
   */
  detectPackageManager(dirPath: string, pkg: PackageJson): string {
    if (existsSync(join(dirPath, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(dirPath, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dirPath, 'package-lock.json'))) return 'npm'
    if (existsSync(join(dirPath, 'bun.lockb'))) return 'bun'

    // Check packageManager field in package.json
    if (pkg.packageManager) {
      const pm = pkg.packageManager.split('@')[0]
      if (['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) {
        return pm
      }
    }

    return 'npm'
  }

  /** Recommend command + args based on package manager and available scripts */
  private recommendCommand(
    packageManager: string,
    scripts: Record<string, string>,
  ): { command: string; args: string[] } {
    // Determine dev script: prefer 'dev' > 'start' > 'serve'
    let devScript = ''
    if (scripts['dev']) {
      devScript = 'dev'
    } else if (scripts['start']) {
      devScript = 'start'
    } else if (scripts['serve']) {
      devScript = 'serve'
    }

    if (!devScript) {
      // No dev script found, just run install
      return {
        command: packageManager,
        args: ['install'],
      }
    }

    // npm/yarn/bun use 'run' prefix; pnpm also supports 'run'
    // yarn doesn't need 'run' but supports it
    if (packageManager === 'yarn') {
      return {
        command: 'yarn',
        args: devScript === 'start' ? ['start'] : ['run', devScript],
      }
    }

    return {
      command: packageManager,
      args: ['run', devScript],
    }
  }

  /** Try to detect port from vite.config, package.json scripts, or common patterns */
  private detectPort(dirPath: string, scripts: Record<string, string>): number | undefined {
    // Check vite.config for port
    const viteConfigPort = this.checkViteConfig(dirPath)
    if (viteConfigPort) return viteConfigPort

    // Check dev script for port argument
    const devScript = scripts['dev'] || scripts['start'] || scripts['serve'] || ''
    const portMatch = devScript.match(/--port\s+(\d+)/)
    if (portMatch) {
      return parseInt(portMatch[1], 10)
    }

    // Check for PORT env in script
    const envPortMatch = devScript.match(/PORT=(\d+)/)
    if (envPortMatch) {
      return parseInt(envPortMatch[1], 10)
    }

    return undefined
  }

  /** Parse vite.config.ts/js for server.port */
  private checkViteConfig(dirPath: string): number | undefined {
    const configFiles = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
    for (const file of configFiles) {
      const configPath = join(dirPath, file)
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8')
          const portMatch = content.match(/port:\s*(\d+)/)
          if (portMatch) {
            return parseInt(portMatch[1], 10)
          }
        } catch {
          // ignore read errors
        }
      }
    }
    return undefined
  }
}

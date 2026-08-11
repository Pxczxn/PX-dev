// PX Dev — Node Project Scanner
// Reads package.json, detects lock files, identifies package manager, parses scripts
//
// Phase 2 起：包管理器 / 框架 / 命令三项判定全部**委托** src/main/detectors 下的纯函数原语，
// 本类只负责读盘、编排与组装 ScanResult，不再自带第二套识别逻辑。

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { DetectionEvidence, ScanResult } from '@shared/types'
import {
  detectNodeFramework,
  detectPackageManager,
  detectStaticPort,
  recommendNodeCommand,
} from '../detectors'
import type { FrameworkAwarePackageJson, FrameworkDetection, PackageManagerId } from '../detectors'
import type { ProjectScanner } from './index'

interface PackageJson extends FrameworkAwarePackageJson {
  name?: string
  version?: string
  packageManager?: string
}

/** package.json 读取结果：解析失败时 parseFailed=true，pkg 退化为空对象 */
interface PackageJsonRead {
  pkg: PackageJson
  parseFailed: boolean
}

export class NodeProjectScanner implements ProjectScanner {
  /** Check if directory contains a package.json */
  canHandle(dirPath: string): boolean {
    return existsSync(join(dirPath, 'package.json'))
  }

  scan(dirPath: string): ScanResult {
    const { pkg, parseFailed } = this.readPackageJson(dirPath)
    const pmDetection = detectPackageManager(dirPath, pkg)
    const packageManager = pmDetection.packageManager
    const scripts = pkg.scripts ?? {}
    const { command, args } = recommendNodeCommand(packageManager, scripts)
    const frameworkDetection = detectNodeFramework(dirPath, pkg, parseFailed)
    const detectedPort = this.detectPort(dirPath, scripts, command, args, frameworkDetection)

    const evidence: DetectionEvidence[] = [
      ...pmDetection.evidence,
      ...frameworkDetection.evidence,
    ]

    return {
      path: dirPath,
      type: 'node',
      packageManager,
      recommendedCommand: command,
      recommendedArgs: args,
      scripts,
      detectedPort,
      // —— Phase 2 增强字段 ——
      framework: frameworkDetection.framework,
      projectType: frameworkDetection.projectType,
      isLibrary: frameworkDetection.isLibrary,
      evidence,
      configFiles: this.collectConfigFiles(pmDetection.lockFiles, frameworkDetection.configFiles),
      confidence: frameworkDetection.framework ? 'high' : 'medium',
    }
  }

  /** Read and parse package.json */
  private readPackageJson(dirPath: string): PackageJsonRead {
    try {
      const raw = readFileSync(join(dirPath, 'package.json'), 'utf-8')
      return { pkg: JSON.parse(raw) as PackageJson, parseFailed: false }
    } catch {
      return { pkg: {}, parseFailed: true }
    }
  }

  /**
   * Detect package manager based on lock files and packageManager field.
   * 保留为公开方法（历史调用点兼容），实现委托 PackageManagerDetector。
   */
  detectPackageManager(dirPath: string, pkg: PackageJson): PackageManagerId {
    return detectPackageManager(dirPath, pkg).packageManager
  }

  /** package.json + lockfile + 框架配置文件，去重后作为该项目的配置文件清单 */
  private collectConfigFiles(lockFiles: string[], frameworkFiles: string[]): string[] {
    const files = ['package.json', ...lockFiles, ...frameworkFiles]
    return [...new Set(files)]
  }

  /**
   * 端口探测：Phase 4 起**完全委托** PortDetector（command > config > env > framework-default）。
   * 相比改造前只看 vite.config + dev 脚本，这里额外覆盖 .env 链与框架默认端口，
   * 且同一套优先级规则被 discovery 侧复用，不再有第二份实现。
   */
  private detectPort(
    dirPath: string,
    scripts: Record<string, string>,
    command: string,
    args: string[],
    frameworkDetection: FrameworkDetection,
  ): number | undefined {
    return detectStaticPort({
      rootPath: dirPath,
      command,
      args,
      scripts,
      framework: frameworkDetection.framework,
      projectType: frameworkDetection.projectType,
      configFiles: frameworkDetection.configFiles,
    })
  }
}

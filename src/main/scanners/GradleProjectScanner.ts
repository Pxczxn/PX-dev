// PX Dev — Gradle Project Scanner
// Detects build.gradle(.kts) + gradlew, recommends bootRun
//
// Phase 2 起：Spring Boot 判定与命令推荐委托 src/main/detectors 下的纯函数原语。

import { existsSync } from 'fs'
import { join } from 'path'
import type { ScanResult } from '@shared/types'
import { detectJavaFramework, detectStaticPort, recommendGradleCommand } from '../detectors'
import type { ProjectScanner } from './index'

export class GradleProjectScanner implements ProjectScanner {
  /** Check if directory contains build.gradle or build.gradle.kts */
  canHandle(dirPath: string): boolean {
    return (
      existsSync(join(dirPath, 'build.gradle')) ||
      existsSync(join(dirPath, 'build.gradle.kts'))
    )
  }

  scan(dirPath: string): ScanResult {
    const frameworkDetection = detectJavaFramework(dirPath, 'gradle')
    const isSpringBoot = frameworkDetection.framework === 'spring-boot'
    const { command, args } = recommendGradleCommand(dirPath, isSpringBoot)
    const detectedPort = this.detectPort(dirPath, frameworkDetection.framework, args)

    return {
      path: dirPath,
      type: 'gradle',
      recommendedCommand: command,
      recommendedArgs: args,
      detectedPort,
      // —— Phase 2 增强字段（packageManager 留空的原因见 MavenProjectScanner 注释）——
      framework: frameworkDetection.framework,
      projectType: frameworkDetection.projectType,
      isLibrary: frameworkDetection.isLibrary,
      evidence: frameworkDetection.evidence,
      configFiles: frameworkDetection.configFiles,
      confidence: isSpringBoot ? 'high' : 'medium',
    }
  }

  /** 端口探测：Phase 4 起**完全委托** PortDetector（细节见 MavenProjectScanner.detectPort 注释） */
  private detectPort(
    dirPath: string,
    framework: string | undefined,
    args: string[],
  ): number | undefined {
    return detectStaticPort({
      rootPath: dirPath,
      command: 'gradle',
      args,
      framework,
      projectType: 'java',
    })
  }
}

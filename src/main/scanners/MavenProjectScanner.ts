// PX Dev — Maven Project Scanner
// Detects pom.xml + mvnw, recommends spring-boot:run
//
// Phase 2 起：Spring Boot 判定与命令推荐委托 src/main/detectors 下的纯函数原语。

import { existsSync } from 'fs'
import { join } from 'path'
import type { ScanResult } from '@shared/types'
import { detectJavaFramework, detectStaticPort, recommendMavenCommand } from '../detectors'
import type { ProjectScanner } from './index'

export class MavenProjectScanner implements ProjectScanner {
  /** Check if directory contains pom.xml */
  canHandle(dirPath: string): boolean {
    return existsSync(join(dirPath, 'pom.xml'))
  }

  scan(dirPath: string): ScanResult {
    const frameworkDetection = detectJavaFramework(dirPath, 'maven')
    const isSpringBoot = frameworkDetection.framework === 'spring-boot'
    const { command, args } = recommendMavenCommand(dirPath, isSpringBoot)
    const detectedPort = this.detectPort(dirPath, frameworkDetection.framework, args)

    return {
      path: dirPath,
      type: 'maven',
      recommendedCommand: command,
      recommendedArgs: args,
      detectedPort,
      // —— Phase 2 增强字段 ——
      // 注意：packageManager 刻意留空。ScanResult.packageManager 会被 ServiceEditDrawer
      // 直接回填到 Service.packageManager（枚举仅含 npm/pnpm/yarn/bun/custom），
      // 写入 'maven' 会导致保存校验失败；Java 的构建工具由 discovery 侧单独映射。
      framework: frameworkDetection.framework,
      projectType: frameworkDetection.projectType,
      isLibrary: frameworkDetection.isLibrary,
      evidence: frameworkDetection.evidence,
      configFiles: frameworkDetection.configFiles,
      confidence: isSpringBoot ? 'high' : 'medium',
    }
  }

  /**
   * 端口探测：Phase 4 起**完全委托** PortDetector。
   * application.properties / yml（缩进感知、支持多文档）由 config 来源负责，
   * 认不出配置时回落到 projectType='java' 的框架默认 8080（与改造前行为一致，但可信度为 low）。
   */
  private detectPort(
    dirPath: string,
    framework: string | undefined,
    args: string[],
  ): number | undefined {
    return detectStaticPort({
      rootPath: dirPath,
      command: 'mvn',
      args,
      framework,
      projectType: 'java',
    })
  }
}

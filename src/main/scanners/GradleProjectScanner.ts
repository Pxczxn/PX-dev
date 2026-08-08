// PX Dev — Gradle Project Scanner
// Detects build.gradle(.kts) + gradlew, recommends bootRun

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ScanResult } from '@shared/types'
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
    const hasGradlew = existsSync(join(dirPath, 'gradlew'))
    const isSpringBoot = this.checkSpringBoot(dirPath)

    let command: string
    let args: string[]

    if (hasGradlew) {
      command = './gradlew'
    } else {
      command = 'gradle'
    }

    if (isSpringBoot) {
      args = ['bootRun']
    } else {
      args = ['run']
    }

    const detectedPort = this.detectPort(dirPath)

    return {
      path: dirPath,
      type: 'gradle',
      recommendedCommand: command,
      recommendedArgs: args,
      detectedPort,
    }
  }

  /** Check if build.gradle contains spring-boot plugin */
  private checkSpringBoot(dirPath: string): boolean {
    const files = ['build.gradle', 'build.gradle.kts']
    for (const file of files) {
      const filePath = join(dirPath, file)
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8')
          if (
            content.includes('org.springframework.boot') ||
            content.includes('spring-boot-gradle-plugin')
          ) {
            return true
          }
        } catch {
          // ignore
        }
      }
    }
    return false
  }

  /** Detect port from application.properties/yml */
  private detectPort(dirPath: string): number | undefined {
    const propFiles = [
      'src/main/resources/application.properties',
      'src/main/resources/application.yml',
      'src/main/resources/application.yaml',
    ]

    for (const file of propFiles) {
      const filePath = join(dirPath, file)
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8')
          const propMatch = content.match(/server\.port\s*[=:]\s*(\d+)/)
          if (propMatch) return parseInt(propMatch[1], 10)

          const yamlMatch = content.match(/port:\s*(\d+)/)
          if (yamlMatch) return parseInt(yamlMatch[1], 10)
        } catch {
          // ignore
        }
      }
    }

    return 8080
  }
}

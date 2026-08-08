// PX Dev — Maven Project Scanner
// Detects pom.xml + mvnw, recommends spring-boot:run

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ScanResult } from '@shared/types'
import type { ProjectScanner } from './index'

export class MavenProjectScanner implements ProjectScanner {
  /** Check if directory contains pom.xml */
  canHandle(dirPath: string): boolean {
    return existsSync(join(dirPath, 'pom.xml'))
  }

  scan(dirPath: string): ScanResult {
    const hasMvnw = existsSync(join(dirPath, 'mvnw'))
    const isSpringBoot = this.checkSpringBoot(dirPath)

    let command: string
    let args: string[]

    if (hasMvnw) {
      command = './mvnw'
    } else {
      command = 'mvn'
    }

    if (isSpringBoot) {
      args = ['spring-boot:run']
    } else {
      args = ['compile', 'exec:java']
    }

    const detectedPort = this.detectPort(dirPath)

    return {
      path: dirPath,
      type: 'maven',
      recommendedCommand: command,
      recommendedArgs: args,
      detectedPort,
    }
  }

  /** Check if pom.xml contains spring-boot dependency */
  private checkSpringBoot(dirPath: string): boolean {
    try {
      const content = readFileSync(join(dirPath, 'pom.xml'), 'utf-8')
      return content.includes('spring-boot-starter') || content.includes('spring-boot-maven-plugin')
    } catch {
      return false
    }
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
          // Properties: server.port=8080
          const propMatch = content.match(/server\.port\s*[=:]\s*(\d+)/)
          if (propMatch) return parseInt(propMatch[1], 10)

          // YAML: port: 8080 (under server:)
          const yamlMatch = content.match(/port:\s*(\d+)/)
          if (yamlMatch) return parseInt(yamlMatch[1], 10)
        } catch {
          // ignore
        }
      }
    }

    // Default Spring Boot port
    return 8080
  }
}

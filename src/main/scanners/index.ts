// PX Dev — Scanner Interface + Registry
// Dispatches directory scanning to the correct project scanner

import type { ScanResult } from '@shared/types'
import { NodeProjectScanner } from './NodeProjectScanner'
import { MavenProjectScanner } from './MavenProjectScanner'
import { GradleProjectScanner } from './GradleProjectScanner'

/** Scanner interface — all project scanners implement this */
export interface ProjectScanner {
  canHandle(dirPath: string): boolean
  scan(dirPath: string): ScanResult
}

/** Unknown directory result (fallback) */
function unknownResult(dirPath: string): ScanResult {
  return {
    path: dirPath,
    type: 'unknown',
    recommendedCommand: '',
    recommendedArgs: [],
  }
}

/** 扫描器可识别的项目种类（probe 的返回域） */
export type ProbeResult = 'node' | 'maven' | 'gradle' | null

/** 创建默认扫描器实例数组（顺序即优先级） */
function createDefaultScanners(): ProjectScanner[] {
  return [new NodeProjectScanner(), new MavenProjectScanner(), new GradleProjectScanner()]
}

/**
 * 默认扫描器常量数组（顺序即优先级）。
 * 扫描器本身无状态，可安全共享；供 discovery 等模块只读遍历使用。
 */
export const PROJECT_SCANNERS: readonly ProjectScanner[] = createDefaultScanners()

/** Registry that dispatches scan to the appropriate scanner */
export class ScannerRegistry {
  private scanners: ProjectScanner[]

  constructor() {
    this.scanners = createDefaultScanners()
  }

  /** Scan a directory and return detection result */
  scan(dirPath: string): ScanResult {
    for (const scanner of this.scanners) {
      if (scanner.canHandle(dirPath)) {
        return scanner.scan(dirPath)
      }
    }
    return unknownResult(dirPath)
  }

  /**
   * 低成本判定目录种类：只走各 scanner 的 canHandle 短路，**不做完整 scan**。
   * 供递归遍历（可能上千个目录）先行过滤，避免逐个完整解析 package.json / pom.xml。
   * 判定失败（含单个 scanner 抛错）一律返回 null，不影响后续扫描器。
   */
  probe(dirPath: string): ProbeResult {
    for (const scanner of this.scanners) {
      try {
        if (!scanner.canHandle(dirPath)) continue
      } catch {
        // 单个扫描器探测抛错（权限 / 长路径）时降级跳过，继续下一个
        continue
      }
      if (scanner instanceof NodeProjectScanner) return 'node'
      if (scanner instanceof MavenProjectScanner) return 'maven'
      if (scanner instanceof GradleProjectScanner) return 'gradle'
    }
    return null
  }
}

export { NodeProjectScanner, MavenProjectScanner, GradleProjectScanner }
export type { ScanResult }

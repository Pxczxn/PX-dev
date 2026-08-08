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

/** Registry that dispatches scan to the appropriate scanner */
export class ScannerRegistry {
  private scanners: ProjectScanner[]

  constructor() {
    this.scanners = [
      new NodeProjectScanner(),
      new MavenProjectScanner(),
      new GradleProjectScanner(),
    ]
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
}

export { NodeProjectScanner, MavenProjectScanner, GradleProjectScanner }
export type { ScanResult }

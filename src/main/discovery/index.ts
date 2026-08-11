// PX Dev — Workspace Discovery 对外 barrel

export { DirectoryWalker, DiscoveryError, isIgnored, isCandidateDir } from './DirectoryWalker'
export { WorkspaceDiscoveryManager } from './WorkspaceDiscoveryManager'

// 运行时端点注册表（Phase 5，纯内存，不落盘）
export {
  DEFAULT_RUNTIME_ENDPOINT_THROTTLE_MS,
  RuntimeEndpointRegistry,
} from './RuntimeEndpointRegistry'
export type {
  BatchListenerHost,
  ConfiguredPortResolver,
  RuntimeEndpointRegistryOptions,
  RuntimeEndpointSender,
  RuntimeLogBatch,
} from './RuntimeEndpointRegistry'

export { IGNORED_DIRS } from './utils/ignoredPaths'
export {
  PROJECT_MARKER_FILES,
  PRIMARY_MARKER_FILES,
  findMarkerFiles,
  mapScanTypeToProjectType,
} from './utils/projectTypeMap'
export {
  compareConfidence,
  lowerConfidence,
  lowestConfidence,
} from './utils/confidence'
export type { Confidence } from './utils/confidence'

// 扫描器桥接（物理实现在 src/main/scanners）
export { ScannerRegistry, PROJECT_SCANNERS } from './scanners'
export type { ProjectScanner, ProbeResult } from './scanners'

// 探测原语桥接（物理实现在 src/main/detectors）
export * from './detectors'

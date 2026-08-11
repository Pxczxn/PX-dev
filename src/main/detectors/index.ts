// PX Dev — detectors 对外 barrel
//
// 本目录只放**纯函数原语**：无 class、无状态、无 electron 依赖，可被 scanners /
// discovery / 测试直接复用，保证 Node/Maven/Gradle 的识别逻辑只有这一份实现。

export {
  PACKAGE_MANAGER_IDS,
  detectPackageManager,
  findLockFiles,
  normalizePackageManagerField,
} from './PackageManagerDetector'
export type {
  PackageManagerDetection,
  PackageManagerAwarePackageJson,
  PackageManagerId,
} from './PackageManagerDetector'

export {
  collectDependencyNames,
  detectJavaFramework,
  detectNodeFramework,
  detectServiceRole,
  hasRunnableScript,
  hasSpringBoot,
} from './FrameworkDetector'
export type {
  FrameworkAwarePackageJson,
  FrameworkDetection,
  JavaBuildKind,
} from './FrameworkDetector'

export {
  DEV_SCRIPT_PRIORITY,
  hasGradleWrapper,
  hasMavenWrapper,
  pickDevScript,
  recommendGradleCommand,
  recommendMavenCommand,
  recommendNodeCommand,
} from './CommandRecommender'
export type { CommandRecommendation } from './CommandRecommender'

export {
  PortDetector,
  detectStaticPort,
  detectStaticPorts,
  parseYamlServerPort,
} from './PortDetector'
export type { PortDetectionContext } from './PortDetector'

// 运行时端点识别（Phase 5）：与 PortDetector 职责严格互补 ——
// PortDetector 管「静态推断」，RuntimeEndpointDetector 管「日志实测」，两者不重叠。
export {
  MAX_ENDPOINTS_PER_PARSE,
  MAX_LINES_PER_PARSE,
  MAX_LINE_LENGTH,
  RuntimeEndpointDetector,
  classifyHost,
  parseRuntimeEndpoints,
  pickPrimaryEndpoint,
  pickPrimaryUrl,
  stripAnsi,
} from './RuntimeEndpointDetector'
export type { RuntimeEndpointParseOptions } from './RuntimeEndpointDetector'

// 端点优先级 / .env 解析（物理实现在 discovery/utils，此处仅做转发，便于 scanners 单点引入）
export {
  ENDPOINT_PRIORITY,
  compareEndpoints,
  dedupeEndpoints,
  endpointRank,
  normalizeEndpoints,
  pickPrimaryPort,
  sortEndpoints,
} from '../discovery/utils/endpointPriority'
export {
  ENV_FILE_PRIORITY,
  ENV_PORT_KEYS,
  parseEnvContent,
  pickEnvPort,
  pickPortFromEnvContent,
  toEnvPort,
} from '../discovery/utils/envFile'
export type { EnvPortHit } from '../discovery/utils/envFile'

// monorepo 根判定（物理实现在 discovery/utils，避免 detectors 与 discovery 双向依赖）
export {
  MONOREPO_MARKER_FILES,
  detectMonorepoRoot,
  hasWorkspacesField,
  isGradleMultiModule,
  isMavenAggregator,
} from '../discovery/utils/monorepo'
export type { MonorepoRootInfo } from '../discovery/utils/monorepo'

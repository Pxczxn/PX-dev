// PX Dev — Workspace 发现管理器（Phase 1 骨架）
//
// 流程：DirectoryWalker.walk() 产出候选目录 → 逐个交给**现有** ScannerRegistry.scan()
// → 映射为最小 DiscoveredProject → 汇总 WorkspaceDiscoveryResult。
//
// 重要约束：本类**不实现任何 Node/Maven/Gradle 识别逻辑**，
// 识别一律复用 src/main/scanners 下的现有扫描器，避免出现平行的第二套判定。

import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { basename, join, relative, resolve, sep } from 'path'
import type {
  DetectedEndpoint,
  DetectionEvidence,
  DiscoveredProject,
  DiscoveryWarning,
  ScanResult,
  WorkspaceDiscoveryOptions,
  WorkspaceDiscoveryResult,
} from '@shared/types'
import { DISCOVERY_DEFAULTS } from '@shared/schemas/discovery.schema'
import { detectStaticPorts } from '../detectors'
import type { ScannerRegistry } from '../scanners'
import { DirectoryWalker } from './DirectoryWalker'
import type { Confidence } from './utils/confidence'
import { lowestConfidence } from './utils/confidence'
import { pickPrimaryPort } from './utils/endpointPriority'
import {
  PRIMARY_MARKER_FILES,
  findMarkerFiles,
  mapScanTypeToProjectType,
} from './utils/projectTypeMap'

/** 单个候选目录在映射前收集到的上下文 */
interface CandidateContext {
  /** 候选目录绝对路径 */
  dirPath: string
  /** 命中的项目标记文件名列表 */
  markerFiles: string[]
  /** 是否存在配置文件解析失败（如 package.json 非法 JSON） */
  parseFailed: boolean
}

export class WorkspaceDiscoveryManager {
  private readonly walker = new DirectoryWalker()

  /** 注入现有 ScannerRegistry，不在内部 new，便于测试替换与复用单例 */
  constructor(private readonly scannerRegistry: ScannerRegistry) {}

  /**
   * 执行一次工作区发现。
   * @param rootPath 工作区根目录
   * @param options 可选参数，未传字段回落到 DISCOVERY_DEFAULTS
   * @throws DiscoveryError root 不存在 / 不是目录
   */
  async discover(
    rootPath: string,
    options?: WorkspaceDiscoveryOptions,
  ): Promise<WorkspaceDiscoveryResult> {
    const startedAt = Date.now()
    const root = resolve(rootPath)

    // 1) 文件系统遍历，得到候选目录
    const walkResult = this.walker.walk(root, options)
    const warnings: DiscoveryWarning[] = [...walkResult.warnings]
    const projects: DiscoveredProject[] = []
    const includeLibrary = options?.includeLibrary ?? DISCOVERY_DEFAULTS.includeLibrary

    for (const dirPath of walkResult.candidates) {
      // 2) 收集标记文件 + 校验可解析性（失败只降级，不中断整体）
      const context = this.buildContext(dirPath, root, warnings)

      // 3) 调用现有扫描器识别；扫描器抛错则降级为 unknown
      const scanResult = this.safeScan(dirPath, root, warnings)

      const project = this.toDiscoveredProject(scanResult, root, context)

      // 4) library 过滤：默认不列出 monorepo library / 不可独立启动的模块；
      //    includeLibrary=true 时保留，但由 suggestedSelected=false 保证不被默认勾选。
      if (project.isLibrary && !includeLibrary) continue

      projects.push(project)
    }

    return {
      rootPath: root,
      scannedAt: startedAt,
      projects,
      warnings,
      stats: {
        ...walkResult.stats,
        // 覆盖为「遍历 + 识别」的总耗时
        elapsedMs: Date.now() - startedAt,
      },
    }
  }

  /**
   * ScanResult → DiscoveredProject 的映射。
   *
   * Phase 2 已填充：
   * - projectType：优先取扫描器精化后的 scanResult.projectType（frontend / node / java），
   *   缺失时回落到 Phase 1 的 mapScanTypeToProjectType
   * - framework / isLibrary / evidence / configFiles：取扫描器（内部委托 detectors）的结果
   * - packageManager：Node 取 scanResult.packageManager；Java 由 scanResult.type 映射为 maven / gradle
   * - command / args：取 scanResult.recommendedCommand / recommendedArgs（structured 形式）
   * - suggestedServiceType / suggestedSelected：供 UI 预填 Service.type 与默认勾选
   *
 * Phase 4 已填充：
 * - endpoints / detectedPort：一律由 PortDetector.detectStatic 产出，
 *   本类不含任何端口解析逻辑；推断不出时两者都留空，不影响后续创建 Service
 *
 * 后续阶段填充点：
 * - Phase 5：runtime-log 来源的端点会以同型对象合并进 endpoints（优先级 50，自动排到静态之前）
 * - Phase 2 增强（暂缓）：monorepo 根的强制下钻（下钻深度不计入 maxDepth，最多额外 2 层）
   *   与 parentProjectId 关联；当前仅正确识别并过滤 library。
   * - Phase 6：matchStatus / matchedServiceId / changes
   */
  private toDiscoveredProject(
    scanResult: ScanResult,
    root: string,
    context: CandidateContext,
  ): DiscoveredProject {
    const relativePath = this.toRelative(root, context.dirPath)
    const name = relativePath === '.' ? basename(root) : basename(context.dirPath)
    const projectType = scanResult.projectType ?? mapScanTypeToProjectType(scanResult.type)
    const confidence = this.resolveConfidence(scanResult, context)
    const isLibrary = scanResult.isLibrary ?? false
    const endpoints = this.detectEndpoints(scanResult, context, projectType)

    return {
      id: this.buildProjectId(root, relativePath),
      path: context.dirPath,
      relativePath,
      name: name || relativePath,
      projectType,
      framework: scanResult.framework,
      packageManager: this.resolvePackageManager(scanResult),
      command: scanResult.recommendedCommand || undefined,
      args: scanResult.recommendedArgs.length > 0 ? [...scanResult.recommendedArgs] : undefined,
      detectedPort: pickPrimaryPort(endpoints),
      endpoints: endpoints.length > 0 ? endpoints : undefined,
      isLibrary,
      suggestedServiceType: this.toServiceType(projectType),
      // Phase 6 会再叠加 `matchStatus !== 'unchanged'` 条件
      suggestedSelected: !isLibrary && confidence !== 'low',
      confidence,
      evidence: this.buildEvidence(scanResult, context),
      configFiles: this.mergeConfigFiles(scanResult, context),
    }
  }

  /**
   * Phase 4：静态端点探测。
   *
   * 全部委托 PortDetector（六路来源：command > config > env > framework-default），
   * 只读候选目录内的已知配置文件（vite/next/nuxt config、application.*、.env* 与 Nest 入口），
   * 不递归子目录，因此不会碰到 node_modules 等被 walker 忽略的目录。
   * 任何解析失败都只是少一条候选，绝不抛错。
   */
  private detectEndpoints(
    scanResult: ScanResult,
    context: CandidateContext,
    projectType: DiscoveredProject['projectType'],
  ): DetectedEndpoint[] {
    try {
      return detectStaticPorts({
        rootPath: context.dirPath,
        command: scanResult.recommendedCommand || undefined,
        args: scanResult.recommendedArgs,
        scripts: scanResult.scripts,
        configFiles: this.mergeConfigFiles(scanResult, context),
        framework: scanResult.framework,
        projectType,
      })
    } catch {
      // 端口推断失败不影响项目被发现与创建
      return []
    }
  }

  /**
   * DiscoveredProject.packageManager：
   * Node 直接取扫描器结果；Java 按构建工具映射（扫描器刻意不填 ScanResult.packageManager，
   * 因为该字段会被 ServiceEditDrawer 直接回填到只接受 npm/pnpm/yarn/bun/custom 的 Service 字段）。
   */
  private resolvePackageManager(scanResult: ScanResult): string | undefined {
    if (scanResult.packageManager) return scanResult.packageManager
    if (scanResult.type === 'maven') return 'maven'
    if (scanResult.type === 'gradle') return 'gradle'
    return undefined
  }

  /** DiscoveryProjectType → Service.type（'unknown' 回落 'generic'） */
  private toServiceType(
    projectType: DiscoveredProject['projectType'],
  ): NonNullable<DiscoveredProject['suggestedServiceType']> {
    switch (projectType) {
      case 'frontend':
      case 'node':
      case 'java':
        return projectType
      default:
        return 'generic'
    }
  }

  /** 标记文件 ∪ 扫描器命中的配置文件，去重后保持「标记文件优先」的顺序 */
  private mergeConfigFiles(scanResult: ScanResult, context: CandidateContext): string[] {
    return [...new Set([...context.markerFiles, ...(scanResult.configFiles ?? [])])]
  }

  /** 稳定 ID：sha1(rootPath + '\0' + relativePath) 取前 16 位，重扫可比对 */
  private buildProjectId(root: string, relativePath: string): string {
    return createHash('sha1').update(`${root}\u0000${relativePath}`).digest('hex').slice(0, 16)
  }

  /** 收集标记文件并做一次低成本的可解析性校验 */
  private buildContext(
    dirPath: string,
    root: string,
    warnings: DiscoveryWarning[],
  ): CandidateContext {
    const markerFiles = findMarkerFiles(dirPath)
    let parseFailed = false

    // 目前只有 package.json 是强 JSON 约束；pom.xml / build.gradle 的解析留待 Phase 2
    if (markerFiles.includes('package.json')) {
      const pkgPath = join(dirPath, 'package.json')
      try {
        if (existsSync(pkgPath)) {
          JSON.parse(readFileSync(pkgPath, 'utf-8'))
        }
      } catch {
        parseFailed = true
        warnings.push({
          code: 'DISCOVERY_PARSE_FAILED',
          message: 'package.json 解析失败，该项目信息可能不完整',
          path: this.toRelative(root, pkgPath),
          severity: 'warn',
        })
      }
    }

    return { dirPath, markerFiles, parseFailed }
  }

  /** 调用现有扫描器；抛错时降级为 unknown 并记 warning，保证整体不中断 */
  private safeScan(dirPath: string, root: string, warnings: DiscoveryWarning[]): ScanResult {
    try {
      return this.scannerRegistry.scan(dirPath)
    } catch (err) {
      warnings.push({
        code: 'DISCOVERY_SCANNER_FAILED',
        message: `扫描器执行失败：${(err as Error)?.message ?? '未知错误'}`,
        path: this.toRelative(root, dirPath),
        severity: 'warn',
      })
      return { path: dirPath, type: 'unknown', recommendedCommand: '', recommendedArgs: [] }
    }
  }

  /**
   * 置信度规则（多来源取最低档）：
   * - 命中主标记文件（package.json / pom.xml / build.gradle[.kts]）→ high
   * - 只有 lockfile / wrapper 脚本 → medium
   * - Phase 2：扫描器自报的 confidence 也参与合并
   *   （识别出具体框架 → high；只知道是 Node/Java 但认不出框架 → medium）
   * - 扫描器判定为 unknown 或配置文件解析失败 → 降为 low
   */
  private resolveConfidence(scanResult: ScanResult, context: CandidateContext): Confidence {
    const hasPrimary = context.markerFiles.some((f) => PRIMARY_MARKER_FILES.includes(f))
    const base: Confidence = hasPrimary ? 'high' : 'medium'
    const factors: Confidence[] = [base]
    if (scanResult.confidence) factors.push(scanResult.confidence)
    if (scanResult.type === 'unknown') factors.push('low')
    if (context.parseFailed) factors.push('low')
    return lowestConfidence(factors)
  }

  /** 证据 = 命中的项目标记文件 + 扫描器（detectors）产出的依赖 / 脚本 / 配置字段级证据 */
  private buildEvidence(
    scanResult: ScanResult,
    context: CandidateContext,
  ): DetectionEvidence[] {
    const markerEvidence: DetectionEvidence[] = context.markerFiles.map((file) => ({
      type: 'marker-file',
      detail: `发现项目标记文件 ${file}`,
      source: file,
    }))
    const scannerEvidence = scanResult.evidence ?? []
    const evidence = [...markerEvidence, ...scannerEvidence]

    if (evidence.length === 0) {
      return [{ type: 'heuristic', detail: '未命中任何项目标记文件', source: 'filesystem' }]
    }
    return evidence
  }

  /** 绝对路径 → 相对 root 的路径；root 自身为 '.'，分隔符统一为 '/' */
  private toRelative(root: string, target: string): string {
    const rel = relative(root, target)
    if (rel === '' || rel === '.') return '.'
    return rel.split(sep).join('/')
  }
}

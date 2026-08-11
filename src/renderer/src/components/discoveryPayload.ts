// PX Dev — Discovery → Service 入参映射（Phase 3）
//
// 职责：把 `DiscoveredProject`（扫描产物）翻译成 `workspace:applyDiscovery` 需要的
// `DiscoveryServiceInput`（等价 main 侧 CreateServiceInput）。
//
// 两条硬约束：
// 1. 产出必须是**纯数据**：一律经 toPlain() 剥离 Vue 响应式 Proxy，
//    否则跨 contextBridge 时会抛 `An object could not be cloned.`；
// 2. 可选字段一律「有值才写」：Zod 里 packageManager / port / args 都是 optional，
//    传空串或 NaN 会直接判定为参数校验失败。

import type { DiscoveredProject, DiscoveryServiceInput } from '@shared/types'
import { toPlain } from '@renderer/api/serialize'

/** Service.packageManager 只接受这几个枚举值；maven / gradle 等一律落到 undefined */
const SERVICE_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'custom'] as const

type ServicePackageManager = (typeof SERVICE_PACKAGE_MANAGERS)[number]

/**
 * DiscoveredProject.packageManager → Service.packageManager。
 * 扫描器可能给出 'maven' / 'gradle' 这类构建工具名，它们不在 Service 的枚举里，
 * 直接省略而不是硬塞 'custom'，避免污染用户可见的包管理器字段。
 */
function toServicePackageManager(value?: string): ServicePackageManager | undefined {
  if (!value) return undefined
  return (SERVICE_PACKAGE_MANAGERS as readonly string[]).includes(value)
    ? (value as ServicePackageManager)
    : undefined
}

/** 端口有效性：Zod 要求 1–65535 的整数，非法值一律省略 */
function toValidPort(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= 1 && value <= 65535 ? value : undefined
}

/**
 * 单个 DiscoveredProject → DiscoveryServiceInput。
 *
 * 字段映射：
 * | Service 字段     | 来源                                                     |
 * | workspaceId     | 调用方传入                                                |
 * | name            | project.name                                             |
 * | type            | project.suggestedServiceType（缺失回落 'generic'）         |
 * | cwd             | project.path（绝对路径）                                   |
 * | command         | project.command（缺失回落 'npm'，保证 Zod 的 min(1) 通过）  |
 * | args            | project.args（空数组则省略）                               |
 * | packageManager  | project.packageManager 且在 Service 枚举内                 |
 * | port            | project.detectedPort（Phase 4 才会有值）                   |
 * | discovery       | { managed:true, lastDetectedAt, sourcePath }（Phase 6 预埋）|
 *
 * discovery 元数据在 main 侧 applyDiscovery 里还会被强制校正一次，
 * 这里填充是为了让 payload 自解释、并让单元测试能直接断言映射结果。
 */
export function toServiceInput(
  project: DiscoveredProject,
  workspaceId: string,
  detectedAt: number = Date.now(),
): DiscoveryServiceInput {
  const input: DiscoveryServiceInput = {
    workspaceId,
    name: project.name,
    type: project.suggestedServiceType ?? 'generic',
    cwd: project.path,
    // 扫描器未给出推荐命令时回落到 npm，用户可在服务表格里二次编辑
    command: project.command && project.command.trim() ? project.command.trim() : 'npm',
    discovery: {
      managed: true,
      lastDetectedAt: detectedAt,
      sourcePath: project.path,
    },
  }

  if (project.args && project.args.length > 0) {
    input.args = [...project.args]
  }

  const packageManager = toServicePackageManager(project.packageManager)
  if (packageManager) {
    input.packageManager = packageManager
  }

  const port = toValidPort(project.detectedPort)
  if (port !== undefined) {
    input.port = port
  }

  // 深度剥离响应式代理：project 常来自 ref/reactive 列表
  return toPlain(input)
}

/** 批量映射；顺序与入参保持一致，便于 UI 对照 */
export function toServiceInputs(
  projects: DiscoveredProject[],
  workspaceId: string,
  detectedAt: number = Date.now(),
): DiscoveryServiceInput[] {
  return projects.map((p) => toServiceInput(p, workspaceId, detectedAt))
}

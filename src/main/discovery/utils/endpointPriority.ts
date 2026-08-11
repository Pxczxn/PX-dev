// PX Dev — 端点优先级工具（Phase 4）
//
// 唯一事实来源：所有端点（静态 Phase 4 / 运行时 Phase 5 / 用户手填）都用同一张
// 优先级表排序，Phase 5 只需产出 source='runtime-log' 的同型对象即可自动排到静态之前。
//
// 约定：
// - `priority` 不落在数据里（DetectedEndpoint 的 Zod schema 是 .strict()，无该字段），
//   一律由 ENDPOINT_PRIORITY[source] 现算，杜绝手填与数据/规则不一致。
// - 排序稳定：优先级相同再比可信度，仍相同则保持插入顺序（先命中的来源在前）。

import type { DetectedEndpoint, DetectedEndpointSource, DiscoveryConfidence } from '@shared/types'

/** 端点来源优先级，数值越大越优先（见设计文档 E.3） */
export const ENDPOINT_PRIORITY: Record<DetectedEndpointSource, number> = {
  /** 用户手填，最高 */
  user: 60,
  /** 运行时日志实测（Phase 5） */
  'runtime-log': 50,
  /** 启动命令显式参数 */
  command: 40,
  /** 配置文件显式声明 */
  config: 30,
  /** 环境变量文件 */
  env: 20,
  /** 框架默认值，兜底 */
  'framework-default': 10,
}

/** 可信度档位权重，数值越大越可信 */
const CONFIDENCE_RANK: Record<DiscoveryConfidence, number> = { low: 0, medium: 1, high: 2 }

/** 取来源对应的数值优先级；未知来源回落 0 */
export function endpointRank(source: DetectedEndpointSource): number {
  return ENDPOINT_PRIORITY[source] ?? 0
}

/** 比较两个端点：a 更优先返回负数（可直接用于 Array.sort 的降序语义） */
export function compareEndpoints(a: DetectedEndpoint, b: DetectedEndpoint): number {
  const byPriority = endpointRank(b.source) - endpointRank(a.source)
  if (byPriority !== 0) return byPriority
  return CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
}

/** 按「优先级 → 可信度」降序稳定排序（不修改入参） */
export function sortEndpoints(endpoints: DetectedEndpoint[]): DetectedEndpoint[] {
  return endpoints
    .map((endpoint, index) => ({ endpoint, index }))
    .sort((a, b) => compareEndpoints(a.endpoint, b.endpoint) || a.index - b.index)
    .map((item) => item.endpoint)
}

/**
 * 同 (type, host, port) 去重，保留优先级/可信度更高的那条。
 * 例：vite.config 写死 5173、框架默认也是 5173 → 只保留 config 那条。
 */
export function dedupeEndpoints(endpoints: DetectedEndpoint[]): DetectedEndpoint[] {
  const kept = new Map<string, DetectedEndpoint>()
  for (const endpoint of endpoints) {
    const key = `${endpoint.type}|${endpoint.host ?? ''}|${endpoint.port ?? ''}`
    const exists = kept.get(key)
    if (!exists || compareEndpoints(endpoint, exists) < 0) {
      kept.set(key, endpoint)
    }
  }
  return [...kept.values()]
}

/** 先去重再排序，得到可直接交给 UI 的端点列表 */
export function normalizeEndpoints(endpoints: DetectedEndpoint[]): DetectedEndpoint[] {
  return sortEndpoints(dedupeEndpoints(endpoints))
}

/** 快照端口 = 排序后第一个带 port 的端点；一个都没有则 undefined（推断失败不影响创建） */
export function pickPrimaryPort(endpoints: DetectedEndpoint[]): number | undefined {
  return sortEndpoints(endpoints).find((endpoint) => typeof endpoint.port === 'number')?.port
}

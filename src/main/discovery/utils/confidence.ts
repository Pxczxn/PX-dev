// PX Dev — 置信度工具
//
// 置信度只有三档：high > medium > low。
// 多个判定来源合并时统一「取最低档」，保证不会因为某一条弱证据抬高整体可信度。

import type { DiscoveryConfidence } from '@shared/types'

/** 置信度类型别名，便于 discovery 内部短名引用 */
export type Confidence = DiscoveryConfidence

/** 档位权重，数值越大越可信 */
const RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

/** 比较两个置信度：a 高于 b 返回正数，低于返回负数，相等返回 0 */
export function compareConfidence(a: Confidence, b: Confidence): number {
  return RANK[a] - RANK[b]
}

/** 取两者中较低的一档（证据合并时的降级规则） */
export function lowerConfidence(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b
}

/** 取一组置信度中最低的一档；空数组回落到 'low' */
export function lowestConfidence(list: Confidence[]): Confidence {
  if (list.length === 0) return 'low'
  return list.reduce((acc, cur) => lowerConfidence(acc, cur))
}

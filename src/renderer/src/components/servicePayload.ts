// PX Dev — Service 表单 payload 规范化 builder
//
// 背景（QA R2）：
// ServiceEditDrawer 的 form 是 Vue 的 ref/reactive Proxy，直接跨 contextBridge 会触发
// `An object could not be cloned.`；虽然 api/index.ts 的统一守卫（createGuardedProxy）
// 已经兜住了「克隆崩溃」，但它只负责**解包**，不负责**语义规范化**。
// 而 shared/schemas/ipc.schema.ts 对若干可选字段有「非空」约束：
//   - openUrl:        z.string().url().optional()               → '' 不是合法 URL
//   - envFile:        z.string().min(1).optional()               → '' 长度不足
//   - packageManager: z.enum([...]).optional()                   → '' / null 不在枚举内
//   - port:           z.number().int().min(1).max(65535).optional() → '' / NaN / null 均非法
//   - startupDelay:   z.number().int().min(0).max(60000).optional() → 同上
// 用户「填了又清空」时这些字段会退化成空串 / null，直接提交必然被 Zod 拒绝，
// 表现为「保存失败」。
//
// 因此本模块负责三件事：
//   1. 调用 toPlain() 深度解包响应式代理（解包职责仍归 toPlain，此处不重复实现）；
//   2. 按 schema 语义做「空值省略 / 数字规整」，并**严格保留合法的 false 与 0**；
//   3. create 与 update 共用同一套规则，避免两条路径的规范化行为不一致。
//
// 注意：schema 中上述字段均为 `.optional()` 而**不接受 null**，
// 因此「清空」语义统一表达为「省略该字段」，而不是传 null。

import { toPlain } from '../api/serialize'

/** 可跨 IPC 结构化克隆的纯数据 payload */
export type ServicePayload = Record<string, unknown>

/** buildServicePayload 的可选参数 */
export interface BuildServicePayloadOptions {
  /** update 场景需要携带的服务 id；create 场景留空 */
  id?: string
}

/** 需要 trim、且「空串即省略」的字符串字段（对应 Zod 的 min(1) / url / enum 约束） */
const STRING_FIELDS: ReadonlySet<string> = new Set([
  'workspaceId',
  'name',
  'type',
  'role',
  'cwd',
  'command',
  'packageManager',
  'envFile',
  'openUrl',
])

/** 需要规整为有限数字、否则省略的数值字段（数字 0 必须保留） */
const NUMBER_FIELDS: ReadonlySet<string> = new Set(['port', 'startupDelay'])

// 字符串数组字段。两者的 Zod 约束不同，**空串的处理必须区别对待**：
//   - args:         z.array(z.string())   → 空串是合法元素（`--flag=` 这类空参数、
//                                            或需要占位的 CLI 实参），不得丢弃
//   - dependencies: z.array(uuidSchema)   → uuidSchema = z.string().min(1)，
//                                            空串会导致整个数组校验失败，必须剔除
// 两者共同点：toPlain() 会把不可克隆元素（函数 / Symbol）置为 null 占位，
// 这些非字符串元素在任何情况下都要过滤，否则 z.string() 直接报错。

/** 保留空串的字符串数组字段 */
const STRING_ARRAY_FIELDS_KEEP_EMPTY: ReadonlySet<string> = new Set(['args'])

/** 剔除空串的字符串数组字段（元素受 min(1) 约束） */
const STRING_ARRAY_FIELDS_DROP_EMPTY: ReadonlySet<string> = new Set(['dependencies'])

/** healthCheck 内部的数值字段 */
const HEALTH_CHECK_NUMBER_FIELDS = ['timeoutMs', 'intervalMs', 'retries'] as const

/**
 * 字符串规范化：trim 后为空则视为「未填写」。
 *
 * 非字符串（null / undefined / number ...）一律返回 undefined，由调用方省略该字段。
 */
function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 数值规范化：把输入框可能产出的空串 / null / 非数字文本统一规整为 undefined（省略）。
 *
 * ⚠️ 0 是合法业务值（如 startupDelay = 0 表示不延迟），必须原样保留，
 * 绝不能因为 `!value` 这类假值判断被误删。
 */
function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    // 仅丢弃 NaN / Infinity，0 与负数交给 Zod 去做范围校验
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') {
      return undefined
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 字符串数组规范化：过滤掉 null / undefined / 非字符串元素。
 *
 * ⚠️ 只做「类型过滤」，不做「空值省略」：空串是否合法取决于字段自身的 Zod 约束，
 * 由调用方通过 `dropEmpty` 明确声明，避免在通用工具里静默改写业务语义。
 *
 * 空数组会被保留（表示「显式清空参数列表」，与「字段缺失」语义不同）。
 *
 * @param value     待处理的值
 * @param dropEmpty 是否剔除空串元素（仅对元素有 min(1) 约束的字段为 true）
 */
function normalizeStringArray(value: unknown, dropEmpty: boolean): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.filter(
    (item): item is string => typeof item === 'string' && (!dropEmpty || item.trim() !== ''),
  )
}

/**
 * healthCheck 规范化：
 * - type 缺失时整个对象对 Zod 无意义（type 为必填），直接省略；
 * - target 为空串时省略（避免把「清空后的检查目标」当成有效值传下去）；
 * - timeoutMs / intervalMs / retries 走数值规整，其中 retries = 0 会被保留。
 */
function normalizeHealthCheck(value: unknown): ServicePayload | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const source = value as Record<string, unknown>
  const result: ServicePayload = {}

  const type = normalizeString(source.type)
  if (type === undefined) {
    return undefined
  }
  result.type = type

  const target = normalizeString(source.target)
  if (target !== undefined) {
    result.target = target
  }

  for (const key of HEALTH_CHECK_NUMBER_FIELDS) {
    const num = normalizeNumber(source[key])
    if (num !== undefined) {
      result[key] = num
    }
  }

  return result
}

/**
 * 由 Service 表单生成可跨 IPC 传输、且满足 Zod schema 语义的纯数据 payload。
 *
 * create 与 update **共用本函数**：update 场景通过 `options.id` 补上服务 id，
 * 其余字段的规范化规则完全一致（UpdateServiceSchema 是 CreateServiceSchema.partial()，
 * 因此「省略」在两种场景下都是安全的表达）。
 *
 * 规范化规则一览：
 * | 字段                         | 清空时的处理            | 保留的边界值   |
 * | openUrl / envFile           | trim 后为空 → 省略      | 非空字符串     |
 * | packageManager / type       | 空串 / null → 省略      | 合法枚举值     |
 * | port / startupDelay         | 空串 / NaN / null → 省略 | **0**         |
 * | args                        | 仅剔除非字符串元素       | **空串元素**   |
 * | dependencies                | 剔除非字符串与空串元素    | 空数组        |
 * | enabled / shellMode / 其余   | 原样保留               | **false / 0** |
 *
 * @param raw     表单对象（可以是 ref / reactive / 普通对象）
 * @param options 可选参数，update 场景传入 `{ id }`
 * @returns 纯数据 payload（不含 Proxy，可被 structuredClone）
 */
export function buildServicePayload(
  raw: unknown,
  options: BuildServicePayloadOptions = {},
): ServicePayload {
  // 1. 深度解包 Vue 响应式代理，之后只处理纯数据
  const plain: unknown = toPlain(raw)

  const payload: ServicePayload = {}

  if (plain !== null && typeof plain === 'object' && !Array.isArray(plain)) {
    const source = plain as Record<string, unknown>

    for (const key of Object.keys(source)) {
      const value = source[key]

      if (STRING_FIELDS.has(key)) {
        const normalized = normalizeString(value)
        if (normalized !== undefined) {
          payload[key] = normalized
        }
        continue
      }

      if (NUMBER_FIELDS.has(key)) {
        const normalized = normalizeNumber(value)
        if (normalized !== undefined) {
          payload[key] = normalized
        }
        continue
      }

      if (STRING_ARRAY_FIELDS_KEEP_EMPTY.has(key) || STRING_ARRAY_FIELDS_DROP_EMPTY.has(key)) {
        const normalized = normalizeStringArray(value, STRING_ARRAY_FIELDS_DROP_EMPTY.has(key))
        if (normalized !== undefined) {
          payload[key] = normalized
        }
        continue
      }

      if (key === 'healthCheck') {
        const normalized = normalizeHealthCheck(value)
        if (normalized !== undefined) {
          payload.healthCheck = normalized
        }
        continue
      }

      // 其余字段原样保留：布尔 false、数字 0、env 对象等都不是「空值」，不得删除。
      // 只丢弃 undefined（与 Zod 的 .optional() 语义一致，也避免 undefined 残留）。
      if (value !== undefined) {
        payload[key] = value
      }
    }
  }

  // 2. update 场景显式补上 id（放在最后，确保不会被表单里的残留值覆盖）
  const id = normalizeString(options.id)
  if (id !== undefined) {
    payload.id = id
  }

  return payload
}

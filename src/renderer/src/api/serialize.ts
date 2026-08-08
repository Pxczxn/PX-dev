// PX Dev — IPC payload 序列化工具
//
// 背景：Vue 3 的 ref/reactive 会把对象包装成 Proxy。
// Electron 的 ipcRenderer.invoke / contextBridge 使用「结构化克隆算法」
// (Structured Clone) 传输参数，而该算法**无法克隆 Proxy 对象**，
// 会直接抛出 `DataCloneError: An object could not be cloned.`。
//
// 因此所有跨进程发送的数据都必须先在此处剥离响应式包装，
// 转换成纯粹的、可结构化克隆的普通数据。

import { isRef, isProxy, toRaw } from 'vue'

/**
 * 深度剥离 Vue 响应式包装，返回可被结构化克隆的纯数据。
 *
 * 处理规则：
 * - `ref` / `reactive` / `readonly` 代理 → 解包为原始值
 * - 函数 / Symbol / undefined → 丢弃（对象属性）或转为 null（数组元素）
 * - `Date` / `Map` / `Set` / 类型化数组 → 保留（结构化克隆原生支持）
 * - 类实例 → 拍平为普通对象（克隆本就会丢失原型）
 * - 循环引用 → 通过 seen 缓存复用，避免无限递归
 *
 * @param value 任意待发送的数据
 * @param seen  内部使用的循环引用缓存
 * @returns 纯数据副本
 */
export function toPlain<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  // 1. ref 解包（isRef 需在 isProxy 之前判断）
  if (isRef(value)) {
    return toPlain(value.value, seen) as unknown as T
  }

  // 2. 原始类型直接返回
  if (value === null || typeof value !== 'object') {
    // 函数与 Symbol 无法克隆，统一丢弃
    if (typeof value === 'function' || typeof value === 'symbol') {
      return undefined as unknown as T
    }
    return value
  }

  // 3. 剥离 reactive / readonly / shallowReactive 的 Proxy 外壳
  const raw = isProxy(value) ? (toRaw(value) as unknown as T) : value

  // 剥壳后可能又是一个 ref（如 reactive 内嵌 ref），需要再走一轮
  if (isRef(raw)) {
    return toPlain(raw.value, seen) as unknown as T
  }

  const rawObj = raw as unknown as object

  // 4. 循环引用复用
  const cached = seen.get(rawObj)
  if (cached !== undefined) {
    return cached as T
  }

  // 5. 结构化克隆原生支持的内置类型，直接复制一份即可
  if (raw instanceof Date) {
    return new Date(raw.getTime()) as unknown as T
  }
  if (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer) {
    return raw
  }

  // 6. 数组
  if (Array.isArray(raw)) {
    const result: unknown[] = []
    seen.set(rawObj, result)
    for (const item of raw) {
      const plainItem = toPlain(item, seen)
      // 数组中不可克隆的元素用 null 占位，保持索引不变
      result.push(plainItem === undefined ? null : plainItem)
    }
    return result as unknown as T
  }

  // 7. Map / Set（结构化克隆支持，但内部元素仍可能是 Proxy）
  if (raw instanceof Map) {
    const result = new Map<unknown, unknown>()
    seen.set(rawObj, result)
    for (const [k, v] of raw.entries()) {
      result.set(toPlain(k, seen), toPlain(v, seen))
    }
    return result as unknown as T
  }
  if (raw instanceof Set) {
    const result = new Set<unknown>()
    seen.set(rawObj, result)
    for (const item of raw.values()) {
      result.add(toPlain(item, seen))
    }
    return result as unknown as T
  }

  // 8. 普通对象 / 类实例 → 重建为纯对象
  const source = raw as Record<string, unknown>
  const result: Record<string, unknown> = {}
  seen.set(rawObj, result)

  // 普通对象与类实例均只取自身可枚举字符串属性（结构化克隆本就会丢弃原型链）
  for (const key of Object.keys(source)) {
    const plainValue = toPlain(source[key], seen)
    // 丢弃 undefined（函数、Symbol 等已在上面转为 undefined），
    // 与 Zod 的 .optional() 语义一致
    if (plainValue !== undefined) {
      result[key] = plainValue
    }
  }

  return result as unknown as T
}

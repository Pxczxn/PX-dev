// PX Dev — contextBridge 序列化边界的忠实模拟
//
// Electron 的 contextBridge 在把「主世界」的实参传给 preload（隔离世界）时，
// 走的是 PassValueToOtherContext()：
//   - 原始类型            → 直接复制
//   - 函数 / Promise      → 代理
//   - 数组 / 纯对象        → 在目标 context 重建（IsPlainObject 明确**排除** Proxy）
//   - 其余（含 JS Proxy） → 退化到结构化克隆，失败即抛
//                          `An object could not be cloned.`
//
// 因此 Vue 的 reactive Proxy 会在「跨 contextBridge」这一步就炸掉，
// preload 里的 ipcRenderer.invoke 根本没机会执行。
// 这也意味着：修复点**只能**放在渲染进程主世界调用 window.pxDev 之前。

import { describe, it, expect } from 'vitest'
import { ref, reactive, isProxy } from 'vue'
import { toPlain } from '@renderer/api/serialize'

/** 模拟 Electron 的 IsPlainObject()：Proxy、Date、Map、Set、数组等都不算「纯对象」 */
function isPlainObjectLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  if (isProxy(value)) return false // 对应 v8 的 object->IsProxy()
  if (Array.isArray(value)) return false
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false
  return true
}

/**
 * 忠实模拟 contextBridge 主世界 → 隔离世界的实参传递。
 * @throws Error('An object could not be cloned.') 当值既非纯对象也不可结构化克隆
 */
function passValueToOtherContext(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value) && !isProxy(value)) {
    return value.map((item) => passValueToOtherContext(item))
  }
  if (isPlainObjectLike(value)) {
    // 在目标 context 重建为真正的纯对象
    const rebuilt: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      rebuilt[key] = passValueToOtherContext((value as Record<string, unknown>)[key])
    }
    return rebuilt
  }
  // 退化路径：结构化克隆，Proxy 在这里必然失败
  return structuredClone(value)
}

/** 模拟 preload 内的 ipcRenderer.invoke —— 再做一次结构化克隆 */
function ipcInvoke(payload: unknown): unknown {
  return structuredClone(payload)
}

/** 完整链路：主世界实参 → contextBridge → ipcRenderer.invoke */
function sendOverBridge(value: unknown): unknown {
  return ipcInvoke(passValueToOtherContext(value))
}

describe('contextBridge 边界 — 何时会抛 An object could not be cloned.', () => {
  it('未处理的 ref 对象（reactive Proxy）在跨 bridge 时就会失败', () => {
    const form = ref({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel' as const,
    })

    expect(() => sendOverBridge(form.value)).toThrow(/could not be cloned/)
  })

  it('reactive() 对象同样会失败', () => {
    const state = reactive({ a: 1, nested: { b: 2 } })
    expect(() => sendOverBridge(state)).toThrow(/could not be cloned/)
  })

  it('纯对象字面量可以安全通过（对应设置页已修复的写法）', () => {
    const payload = {
      theme: 'dark',
      closeBehavior: 'tray',
      maxLogLines: 5000,
      startMinimized: false,
    }
    expect(() => sendOverBridge(payload)).not.toThrow()
    expect(sendOverBridge(payload)).toEqual(payload)
  })

  it('toPlain() 处理后的创建工作区表单可以安全通过', () => {
    const form = ref({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel' as const,
    })

    const payload = toPlain(form.value)

    expect(() => sendOverBridge(payload)).not.toThrow()
    expect(sendOverBridge(payload)).toEqual({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel',
    })
  })

  it('嵌套响应式（服务表单里的 args / env / healthCheck）经 toPlain 后同样安全', () => {
    const form = ref({
      workspaceId: 'ws-1',
      name: 'api',
      args: ['run', 'dev'],
      env: { NODE_ENV: 'development' },
      healthCheck: { type: 'http', target: 'http://localhost:3000', retries: 3 },
    })

    expect(() => sendOverBridge(form.value)).toThrow(/could not be cloned/)
    expect(() => sendOverBridge(toPlain(form.value))).not.toThrow()
  })
})

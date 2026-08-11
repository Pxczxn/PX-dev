// PX Dev — IPC 序列化回归测试
// 覆盖 bug：设置页面「保存设置」报错 `An object could not be cloned.`

import { describe, it, expect } from 'vitest'
import { ref, reactive, readonly, shallowRef } from 'vue'
import { toPlain } from '@renderer/api/serialize'

describe('toPlain — Vue 响应式对象的 IPC 序列化', () => {
  it('复现原始 bug：reactive 代理无法被结构化克隆', () => {
    const settings = ref({ theme: 'light', maxLogLines: 5000 })
    // settings.value 是 reactive Proxy，structuredClone 会抛 DataCloneError
    expect(() => structuredClone(settings.value)).toThrow(/could not be cloned/)
  })

  it('修复后：toPlain 处理过的设置对象可被结构化克隆', () => {
    const settings = ref({
      theme: 'light',
      closeBehavior: 'tray',
      maxLogLines: 5000,
      startMinimized: false,
      autoRestoreLastSession: false,
      startupInterval: 1000,
      showTimestamp: true,
      defaultBrowser: 'system',
    })

    const plain = toPlain(settings.value)

    expect(() => structuredClone(plain)).not.toThrow()
    expect(structuredClone(plain)).toEqual({
      theme: 'light',
      closeBehavior: 'tray',
      maxLogLines: 5000,
      startMinimized: false,
      autoRestoreLastSession: false,
      startupInterval: 1000,
      showTimestamp: true,
      defaultBrowser: 'system',
    })
  })

  it('深层嵌套的数组与对象也会被剥离代理', () => {
    const form = ref({
      name: 'svc',
      args: ['run', 'dev'],
      env: { NODE_ENV: 'development' },
      healthCheck: { type: 'http', target: 'http://localhost:3000', retries: 3 },
    })

    // 浅展开无法解决嵌套代理问题
    expect(() => structuredClone({ id: 'x', ...form.value })).toThrow(/could not be cloned/)

    const plain = toPlain({ id: 'x', ...form.value })
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain.args).toEqual(['run', 'dev'])
    expect(plain.healthCheck).toEqual({
      type: 'http',
      target: 'http://localhost:3000',
      retries: 3,
    })
  })

  it('支持 reactive / readonly / 嵌套 ref 的解包', () => {
    const state = reactive({ count: 1, nested: { flag: true } })
    const ro = readonly(state)
    const withRef = { value: ref(42), shallow: shallowRef({ a: 1 }) }

    expect(() => structuredClone(toPlain(state))).not.toThrow()
    expect(() => structuredClone(toPlain(ro))).not.toThrow()

    expect(toPlain(state)).toEqual({ count: 1, nested: { flag: true } })
    expect(toPlain(withRef)).toEqual({ value: 42, shallow: { a: 1 } })
  })

  it('丢弃函数与 Symbol，保留 Date', () => {
    const now = new Date('2024-01-01T00:00:00.000Z')
    const input = reactive({
      keep: 'yes',
      when: now,
      fn: () => 'nope',
      [Symbol('s')]: 'ignored',
    })

    const plain = toPlain(input) as Record<string, unknown>

    expect(plain.keep).toBe('yes')
    expect(plain.fn).toBeUndefined()
    expect(plain.when).toBeInstanceOf(Date)
    expect((plain.when as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(() => structuredClone(plain)).not.toThrow()
  })

  it('循环引用不会导致栈溢出', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    const state = reactive(a)

    const plain = toPlain(state) as Record<string, unknown>
    expect(plain.name).toBe('a')
    expect(plain.self).toBe(plain)
    expect(() => structuredClone(plain)).not.toThrow()
  })

  it('原始类型与 null 原样返回', () => {
    expect(toPlain(1)).toBe(1)
    expect(toPlain('s')).toBe('s')
    expect(toPlain(true)).toBe(true)
    expect(toPlain(null)).toBeNull()
    expect(toPlain(undefined)).toBeUndefined()
  })
})

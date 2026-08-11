// PX Dev — Service payload builder 边界测试
//
// 覆盖 QA R2：ServiceEditDrawer 保存时把 reactive form 直接下发，
// 导致 openUrl='' / envFile='' / port='' 这类「填了又清空」的字段被 Zod 拒绝。
//
// 本测试不挂载 .vue 组件，直接对纯函数 buildServicePayload 做断言，
// 与 tests/serialize.test.ts（toPlain 解包）形成互补：
//   - toPlain          → 负责剥离 Proxy，保证可结构化克隆
//   - buildServicePayload → 负责按 Zod schema 语义做空值省略 / 数字规整

import { describe, it, expect } from 'vitest'
import { ref, reactive, isProxy } from 'vue'
import { buildServicePayload } from '@renderer/components/servicePayload'

/** 判断字段是否被真正省略（既不是 undefined 残留，也不是 own property） */
function isOmitted(payload: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(payload, key)
}

/** 一份合法的最小创建表单 */
function baseForm(): Record<string, unknown> {
  return {
    workspaceId: 'ws-1',
    name: 'web',
    type: 'frontend',
    cwd: 'D:/proj/web',
    command: 'npm',
    args: ['run', 'dev'],
    enabled: true,
    dependencies: [],
    shellMode: false,
    healthCheck: { type: 'none' },
  }
}

describe('buildServicePayload — 空串省略（Zod min(1) / url 约束）', () => {
  it('openUrl 为空串时省略该字段，且无 undefined 残留', () => {
    const payload = buildServicePayload({ ...baseForm(), openUrl: '' })

    expect(isOmitted(payload, 'openUrl')).toBe(true)
    expect(Object.values(payload).every((v) => v !== undefined)).toBe(true)
  })

  it('openUrl 仅含空白时同样省略；有值时 trim 后保留', () => {
    expect(isOmitted(buildServicePayload({ openUrl: '   ' }), 'openUrl')).toBe(true)
    expect(buildServicePayload({ openUrl: '  http://localhost:3000  ' }).openUrl).toBe(
      'http://localhost:3000',
    )
  })

  it('envFile 为空串 / null 时省略；有值时保留', () => {
    expect(isOmitted(buildServicePayload({ ...baseForm(), envFile: '' }), 'envFile')).toBe(true)
    expect(isOmitted(buildServicePayload({ ...baseForm(), envFile: null }), 'envFile')).toBe(true)
    expect(buildServicePayload({ envFile: 'D:/proj/.env' }).envFile).toBe('D:/proj/.env')
  })
})

describe('buildServicePayload — 数值字段规整（保留 0）', () => {
  it('port 为空串 / 非数字文本 / null 时省略', () => {
    expect(isOmitted(buildServicePayload({ port: '' }), 'port')).toBe(true)
    expect(isOmitted(buildServicePayload({ port: 'abc' }), 'port')).toBe(true)
    expect(isOmitted(buildServicePayload({ port: null }), 'port')).toBe(true)
    expect(isOmitted(buildServicePayload({ port: Number.NaN }), 'port')).toBe(true)
  })

  it('port 为 0 与合法数字时保留（0 不得被当成空值删掉）', () => {
    expect(buildServicePayload({ port: 0 }).port).toBe(0)
    expect(buildServicePayload({ port: 3000 }).port).toBe(3000)
    // 数字输入框在部分场景会回传字符串，需要被规整为 number
    expect(buildServicePayload({ port: '5173' }).port).toBe(5173)
  })

  it('startupDelay 为空串 / 非数字时省略，为 0 时保留', () => {
    expect(isOmitted(buildServicePayload({ startupDelay: '' }), 'startupDelay')).toBe(true)
    expect(isOmitted(buildServicePayload({ startupDelay: 'abc' }), 'startupDelay')).toBe(true)
    expect(isOmitted(buildServicePayload({ startupDelay: null }), 'startupDelay')).toBe(true)
    expect(buildServicePayload({ startupDelay: 0 }).startupDelay).toBe(0)
    expect(buildServicePayload({ startupDelay: 1500 }).startupDelay).toBe(1500)
  })
})

describe('buildServicePayload — 枚举字段清空', () => {
  it('packageManager 为空串 / null / undefined 时省略', () => {
    expect(isOmitted(buildServicePayload({ packageManager: '' }), 'packageManager')).toBe(true)
    expect(isOmitted(buildServicePayload({ packageManager: null }), 'packageManager')).toBe(true)
    expect(isOmitted(buildServicePayload({ packageManager: undefined }), 'packageManager')).toBe(
      true,
    )
  })

  it('packageManager 有值时保留', () => {
    expect(buildServicePayload({ packageManager: 'pnpm' }).packageManager).toBe('pnpm')
  })
})

describe('buildServicePayload — 必须保留 false 与 0', () => {
  it('布尔 false 与数字 0 不会被「空值省略」逻辑误删', () => {
    const payload = buildServicePayload({
      ...baseForm(),
      enabled: false,
      shellMode: false,
      autoOpenBrowser: false,
      someBool: false,
      someNum: 0,
      port: 0,
      startupDelay: 0,
    })

    expect(payload.enabled).toBe(false)
    expect(payload.shellMode).toBe(false)
    expect(payload.autoOpenBrowser).toBe(false)
    expect(payload.someBool).toBe(false)
    expect(payload.someNum).toBe(0)
    expect(payload.port).toBe(0)
    expect(payload.startupDelay).toBe(0)
  })

  it('空数组与空字符串值的 env 记录原样保留（非「未填写」语义）', () => {
    const payload = buildServicePayload({ args: [], dependencies: [], env: { EMPTY: '' } })

    expect(payload.args).toEqual([])
    expect(payload.dependencies).toEqual([])
    expect(payload.env).toEqual({ EMPTY: '' })
  })
})

describe('buildServicePayload — 字符串数组按各自 Zod 约束区别处理', () => {
  // args 是 z.array(z.string())：空串是合法元素，属于用户可能刻意传入的 CLI 参数；
  // dependencies 是 z.array(z.string().min(1))：空串会让整个数组校验失败，必须剔除。
  it('args 保留空串元素（z.array(z.string()) 接受空串，不得静默丢弃）', () => {
    const payload = buildServicePayload({ args: ['run', '', 'dev', '  '] })

    expect(payload.args).toEqual(['run', '', 'dev', '  '])
  })

  it('dependencies 剔除空串元素（元素受 min(1) 约束）', () => {
    const payload = buildServicePayload({ dependencies: ['svc-1', '', 'svc-2', '   '] })

    expect(payload.dependencies).toEqual(['svc-1', 'svc-2'])
  })

  it('两者都剔除 toPlain 留下的非字符串占位元素（函数 → null）', () => {
    const payload = buildServicePayload({
      args: ['run', () => 'nope', 42, null],
      dependencies: ['svc-1', () => 'nope', null],
    })

    expect(payload.args).toEqual(['run'])
    expect(payload.dependencies).toEqual(['svc-1'])
    expect(() => structuredClone(payload)).not.toThrow()
  })

  it('非数组输入时省略该字段', () => {
    expect(isOmitted(buildServicePayload({ args: 'run dev' }), 'args')).toBe(true)
    expect(isOmitted(buildServicePayload({ dependencies: null }), 'dependencies')).toBe(true)
  })
})

describe('buildServicePayload — 响应式输入解包', () => {
  it('ref 输入：输出不含 Proxy 且可被 structuredClone', () => {
    const form = ref({ ...baseForm(), openUrl: '', port: '' })

    // 直接下发 ref.value 会炸（这正是原始 bug）
    expect(() => structuredClone(form.value)).toThrow(/could not be cloned/)

    const payload = buildServicePayload(form)

    expect(isProxy(payload)).toBe(false)
    expect(isProxy(payload.healthCheck)).toBe(false)
    expect(() => structuredClone(payload)).not.toThrow()
    expect(isOmitted(payload, 'openUrl')).toBe(true)
    expect(isOmitted(payload, 'port')).toBe(true)
  })

  it('reactive 输入：嵌套对象 / 数组同样被解包', () => {
    const form = reactive({
      ...baseForm(),
      env: { NODE_ENV: 'development' },
      healthCheck: { type: 'http', target: 'http://localhost:3000/health', retries: 3 },
    })

    const payload = buildServicePayload(form)

    expect(isProxy(payload.env)).toBe(false)
    expect(isProxy(payload.args)).toBe(false)
    expect(isProxy(payload.healthCheck)).toBe(false)
    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload.args).toEqual(['run', 'dev'])
    expect(payload.env).toEqual({ NODE_ENV: 'development' })
    expect(payload.healthCheck).toEqual({
      type: 'http',
      target: 'http://localhost:3000/health',
      retries: 3,
    })
  })

  it('非对象输入（null / 原始值）退化为空对象，不抛异常', () => {
    expect(buildServicePayload(null)).toEqual({})
    expect(buildServicePayload(undefined)).toEqual({})
    expect(buildServicePayload('nope')).toEqual({})
  })
})

describe('buildServicePayload — 嵌套 healthCheck 规范化', () => {
  it('target 为空串时省略 target，但保留 type', () => {
    const payload = buildServicePayload({ healthCheck: { type: 'port', target: '' } })
    const healthCheck = payload.healthCheck as Record<string, unknown>

    expect(healthCheck.type).toBe('port')
    expect(isOmitted(healthCheck, 'target')).toBe(true)
  })

  it('retries = 0 被保留，超时字段为空串时省略', () => {
    const payload = buildServicePayload({
      healthCheck: { type: 'http', target: 'http://a/b', retries: 0, timeoutMs: '' },
    })
    const healthCheck = payload.healthCheck as Record<string, unknown>

    expect(healthCheck.retries).toBe(0)
    expect(isOmitted(healthCheck, 'timeoutMs')).toBe(true)
  })

  it('healthCheck 缺少 type 时整体省略（type 在 Zod 中为必填）', () => {
    expect(isOmitted(buildServicePayload({ healthCheck: { target: 'x' } }), 'healthCheck')).toBe(
      true,
    )
    expect(isOmitted(buildServicePayload({ healthCheck: null }), 'healthCheck')).toBe(true)
  })
})

describe('buildServicePayload — create 与 update 共用同一套规则', () => {
  it('create 场景：不带 id，空值字段被省略', () => {
    const createForm = ref({ ...baseForm(), openUrl: '', envFile: '', port: '', startupDelay: '' })
    const payload = buildServicePayload(createForm.value)

    expect(isOmitted(payload, 'id')).toBe(true)
    expect(isOmitted(payload, 'openUrl')).toBe(true)
    expect(isOmitted(payload, 'envFile')).toBe(true)
    expect(isOmitted(payload, 'port')).toBe(true)
    expect(isOmitted(payload, 'startupDelay')).toBe(true)
    expect(payload.name).toBe('web')
  })

  it('update 场景：带 id，且空值字段的省略行为与 create 完全一致', () => {
    const shared = { ...baseForm(), openUrl: '', envFile: '', port: '', startupDelay: '' }

    const createPayload = buildServicePayload(reactive({ ...shared }))
    const updatePayload = buildServicePayload(reactive({ ...shared }), { id: 'svc-1' })

    expect(updatePayload.id).toBe('svc-1')

    // 除 id 外两者应当完全一致
    const updateWithoutId = { ...updatePayload }
    delete updateWithoutId.id
    expect(updateWithoutId).toEqual(createPayload)
  })

  it('update 场景：options.id 优先于表单里的残留 id', () => {
    const payload = buildServicePayload({ id: 'stale-id', name: 'web' }, { id: 'svc-2' })
    expect(payload.id).toBe('svc-2')
  })

  it('update 场景：未传 id 时不会凭空造出 id 字段', () => {
    expect(isOmitted(buildServicePayload({ name: 'web' }, {}), 'id')).toBe(true)
    expect(isOmitted(buildServicePayload({ name: 'web' }, { id: '   ' }), 'id')).toBe(true)
  })
})

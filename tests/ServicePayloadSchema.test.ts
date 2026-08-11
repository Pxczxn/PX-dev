// PX Dev — buildServicePayload × Zod schema 契约测试（QA 独立验证）
//
// 与 tests/ServicePayload.test.ts 的分工：
//   - ServicePayload.test.ts       → 断言 builder 输出的**形状**（哪些字段被省略/保留）
//   - ServicePayloadSchema.test.ts → 断言 builder 输出能真正**通过 Zod 校验**
//
// 为什么需要这一层：R2 的用户可见症状是「保存失败」，其根因是 payload 被
// shared/schemas/ipc.schema.ts 的 Zod 拒绝。只验证形状无法证明 bug 已修复，
// 必须把 builder 的输出真实喂给 schema 才算闭环。
//
// 同时本文件把「为什么是省略而不是传 null」这一关键设计决策固化为可执行断言：
// 相关字段全是 .optional() 而非 .nullable()，传 null 会被直接拒绝。

import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { buildServicePayload } from '@renderer/components/servicePayload'
import { CreateServiceSchema, UpdateServiceSchema } from '@shared/schemas/ipc.schema'

/**
 * 复刻 R2 的真实场景：用户把可选字段「填了又清空」。
 * naive-ui 的清空行为：NInput → ''，NInputNumber → null，NSelect(clearable) → null。
 */
function clearedForm(): Record<string, unknown> {
  return {
    workspaceId: 'ws-1',
    name: 'web',
    type: 'frontend',
    role: 'frontend',
    cwd: 'D:/proj/web',
    command: 'npm',
    args: ['run', 'dev'],
    enabled: true,
    dependencies: [],
    shellMode: false,
    healthCheck: { type: 'none' },
    // ↓ 以下均为「填了又清空」的残留值
    packageManager: null,
    port: null,
    startupDelay: null,
    openUrl: '',
    envFile: '',
  }
}

describe('R2 契约 — builder 输出必须通过 CreateServiceSchema', () => {
  it('修复前的原始表单会被 Zod 拒绝（证明 bug 真实存在，断言非空转）', () => {
    const result = CreateServiceSchema.safeParse(clearedForm())

    expect(result.success).toBe(false)
    // 确认失败确实来自那几个「清空」字段，而不是别的原因
    const badFields = result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
    expect(badFields).toEqual(
      expect.arrayContaining(['packageManager', 'port', 'openUrl', 'envFile']),
    )
  })

  it('经 builder 规范化后可通过 Zod 校验（R2 闭环）', () => {
    const payload = buildServicePayload(clearedForm())
    const result = CreateServiceSchema.safeParse(payload)

    expect(result.success).toBe(true)
  })

  it('响应式表单（reactive）同样可通过校验，且输出可结构化克隆', () => {
    const payload = buildServicePayload(reactive(clearedForm()))

    expect(() => structuredClone(payload)).not.toThrow()
    expect(CreateServiceSchema.safeParse(payload).success).toBe(true)
  })
})

describe('R2 设计决策固化 — 只能省略，不能传 null', () => {
  it.each(['packageManager', 'port', 'startupDelay', 'openUrl', 'envFile'])(
    '%s 传 null 会被 Zod 拒绝（字段是 .optional() 而非 .nullable()）',
    (field) => {
      const base = buildServicePayload(clearedForm())
      const withNull = { ...base, [field]: null }

      expect(CreateServiceSchema.safeParse(withNull).success).toBe(false)
    },
  )

  it.each(['openUrl', 'envFile'])('%s 传空串同样会被拒绝', (field) => {
    const base = buildServicePayload(clearedForm())

    expect(CreateServiceSchema.safeParse({ ...base, [field]: '' }).success).toBe(false)
  })
})

describe('保留 false / 0 — 经 schema 校验后语义不丢失', () => {
  it('enabled=false / shellMode=false / autoOpenBrowser=false 原样落到解析结果', () => {
    const payload = buildServicePayload({
      ...clearedForm(),
      enabled: false,
      shellMode: false,
      autoOpenBrowser: false,
    })
    const result = CreateServiceSchema.safeParse(payload)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)
      expect(result.data.shellMode).toBe(false)
      expect(result.data.autoOpenBrowser).toBe(false)
    }
  })

  it('startupDelay=0 是合法值，必须通过校验且保持为 0', () => {
    const result = CreateServiceSchema.safeParse(
      buildServicePayload({ ...clearedForm(), startupDelay: 0 }),
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.startupDelay).toBe(0)
    }
  })

  it('port=0 被原样透传给 Zod，由 schema 报范围错（不被 builder 静默吞掉）', () => {
    const payload = buildServicePayload({ ...clearedForm(), port: 0 })

    // builder 保留 0
    expect(payload.port).toBe(0)

    // 交由 Zod 给出明确的范围错误，而不是悄悄丢字段导致用户以为保存成功
    const result = CreateServiceSchema.safeParse(payload)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'port')).toBe(true)
    }
  })
})

describe('create / update 共用规则 — 两条路径都满足各自 schema', () => {
  it('update payload 通过 UpdateServiceSchema，且除 id 外与 create 完全一致', () => {
    const form = clearedForm()

    const createPayload = buildServicePayload(reactive({ ...form }))
    const updatePayload = buildServicePayload(reactive({ ...form }), { id: 'svc-1' })

    expect(CreateServiceSchema.safeParse(createPayload).success).toBe(true)
    expect(UpdateServiceSchema.safeParse(updatePayload).success).toBe(true)

    const updateWithoutId = { ...updatePayload }
    delete updateWithoutId.id
    expect(updateWithoutId).toEqual(createPayload)
  })

  it('update 场景清空 openUrl 后不会因残留空串失败', () => {
    const payload = buildServicePayload(
      { ...clearedForm(), openUrl: '   ' },
      { id: 'svc-1' },
    )

    expect(Object.prototype.hasOwnProperty.call(payload, 'openUrl')).toBe(false)
    expect(UpdateServiceSchema.safeParse(payload).success).toBe(true)
  })
})

describe('编辑模式真实路径 — form = { ...service } 的整份展开', () => {
  /** 编辑模式下抽屉会把完整 Service 展开进 form，含 createdAt/updatedAt/id 等非表单字段 */
  function fullService(): Record<string, unknown> {
    return {
      id: 'svc-1',
      workspaceId: 'ws-1',
      name: 'web',
      type: 'frontend',
      role: 'frontend',
      cwd: 'D:/proj/web',
      command: 'npm',
      args: ['run', 'dev'],
      enabled: true,
      dependencies: [],
      shellMode: false,
      healthCheck: { type: 'none' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    }
  }

  it('额外字段不会导致校验失败（Zod 默认 strip 未知键）', () => {
    const payload = buildServicePayload(reactive(fullService()), { id: 'svc-1' })
    const result = UpdateServiceSchema.safeParse(payload)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('svc-1')
      expect('createdAt' in result.data).toBe(false)
      expect('updatedAt' in result.data).toBe(false)
    }
  })

  it('编辑时清空 openUrl / port，更新仍能通过校验', () => {
    const payload = buildServicePayload(
      reactive({ ...fullService(), openUrl: '', port: null, packageManager: null }),
      { id: 'svc-1' },
    )

    expect(UpdateServiceSchema.safeParse(payload).success).toBe(true)
  })
})

describe('数组字段 — args 与 dependencies 的 Zod 约束相反，不可一视同仁', () => {
  // args:         z.array(z.string())            → 元素接受空串
  // dependencies: z.array(z.string().min(1))     → 元素拒绝空串
  // 因此「统一保留」会让 dependencies 失败，「统一剔除」会静默丢弃 args 数据。

  it('args 保留空串元素后仍通过校验（证明保留是安全的）', () => {
    const payload = buildServicePayload({ ...clearedForm(), args: ['run', '', 'dev'] })

    expect(payload.args).toEqual(['run', '', 'dev'])
    expect(CreateServiceSchema.safeParse(payload).success).toBe(true)
  })

  it('dependencies 若保留空串会被 Zod 拒绝（证明剔除是必需的，非过度设计）', () => {
    const payload = buildServicePayload({ ...clearedForm(), dependencies: ['svc-1', ''] })

    // builder 已剔除空串
    expect(payload.dependencies).toEqual(['svc-1'])
    expect(CreateServiceSchema.safeParse(payload).success).toBe(true)

    // 反向验证：若未剔除，整个数组校验失败
    const notCleaned = CreateServiceSchema.safeParse({ ...payload, dependencies: ['svc-1', ''] })
    expect(notCleaned.success).toBe(false)
    if (!notCleaned.success) {
      expect(notCleaned.error.issues.some((i) => i.path[0] === 'dependencies')).toBe(true)
    }
  })

  it('两者都剔除 toPlain 留下的 null 占位与非字符串元素', () => {
    const payload = buildServicePayload({
      ...clearedForm(),
      args: ['run', null, 42, 'dev'],
      dependencies: ['svc-1', null, undefined],
    })

    expect(payload.args).toEqual(['run', 'dev'])
    expect(payload.dependencies).toEqual(['svc-1'])
    expect(CreateServiceSchema.safeParse(payload).success).toBe(true)
  })

  it('函数元素经 toPlain 转为 null 后被剔除，输出仍可结构化克隆', () => {
    const payload = buildServicePayload({
      ...clearedForm(),
      args: ['run', () => 'boom', 'dev'],
    })

    expect(payload.args).toEqual(['run', 'dev'])
    expect(() => structuredClone(payload)).not.toThrow()
    expect(CreateServiceSchema.safeParse(payload).success).toBe(true)
  })
})

describe('合法值不被误伤', () => {
  it('填写完整的表单所有字段都保留并通过校验', () => {
    const payload = buildServicePayload({
      ...clearedForm(),
      packageManager: 'pnpm',
      port: 5173,
      startupDelay: 1500,
      openUrl: 'http://localhost:5173',
      envFile: 'D:/proj/web/.env',
      env: { NODE_ENV: 'development' },
      autoOpenBrowser: true,
      healthCheck: { type: 'http', target: 'http://localhost:5173/health', retries: 0 },
    })
    const result = CreateServiceSchema.safeParse(payload)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.packageManager).toBe('pnpm')
      expect(result.data.port).toBe(5173)
      expect(result.data.startupDelay).toBe(1500)
      expect(result.data.openUrl).toBe('http://localhost:5173')
      expect(result.data.envFile).toBe('D:/proj/web/.env')
      expect(result.data.env).toEqual({ NODE_ENV: 'development' })
      expect(result.data.healthCheck?.retries).toBe(0)
    }
  })
})

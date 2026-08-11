// PX Dev — Discovery → CreateServiceInput 映射测试（Phase 3）
//
// 被测对象：`src/renderer/src/components/discoveryPayload.ts` 的
// toServiceInput / toServiceInputs —— 把扫描产物 DiscoveredProject
// 翻译成 workspace:applyDiscovery 需要的 DiscoveryServiceInput。
//
// 三条关注点：
// 1. 枚举收敛：DiscoveredProject.packageManager 可能是 'maven'/'gradle'，
//    不在 Service 枚举内必须省略而不是硬塞 'custom'；
// 2. 空值省略：Zod 里 args/port/packageManager 都是 optional，
//    传 undefined / 空数组 / 越界端口都会导致校验失败或脏数据；
// 3. 纯数据：产出必须能过 structuredClone（跨 contextBridge 的硬门槛）。
//
// 同时用 CreateServiceSchema 做一次真实 Zod 校验，
// 确保映射结果确实能被 main 侧 workspace:applyDiscovery 接受。

import { describe, it, expect } from 'vitest'
import { ref, reactive, isProxy } from 'vue'
import type { DiscoveredProject } from '@shared/types'
import { CreateServiceSchema, ApplyDiscoverySchema } from '@shared/schemas'
import { toServiceInput, toServiceInputs } from '@renderer/components/discoveryPayload'

/** 判断字段是否被真正省略（不是 undefined 残留） */
function isOmitted(payload: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(payload, key)
}

/** 合法 uuid，Zod 的 workspaceId 是 uuid 约束 */
const WS_ID = '11111111-1111-4111-8111-111111111111'

/** 一份最小的扫描产物 */
function baseProject(overrides: Partial<DiscoveredProject> = {}): DiscoveredProject {
  return {
    id: 'abc0123456789def',
    path: 'D:/proj/web',
    relativePath: 'web',
    name: 'web',
    projectType: 'frontend',
    confidence: 'high',
    evidence: [{ type: 'marker-file', detail: '命中 package.json', source: 'web/package.json' }],
    configFiles: ['package.json'],
    ...overrides,
  }
}

describe('toServiceInput — 基础字段映射', () => {
  it('name / cwd / type / command / args 按约定映射', () => {
    const input = toServiceInput(
      baseProject({
        suggestedServiceType: 'frontend',
        command: 'npm',
        args: ['run', 'dev'],
      }),
      WS_ID,
      1700000000000,
    )

    expect(input.workspaceId).toBe(WS_ID)
    expect(input.name).toBe('web')
    expect(input.type).toBe('frontend')
    expect(input.cwd).toBe('D:/proj/web')
    expect(input.command).toBe('npm')
    expect(input.args).toEqual(['run', 'dev'])
  })

  it('suggestedServiceType 缺失时 type 回落 generic（含 projectType=unknown 的情况）', () => {
    const input = toServiceInput(baseProject({ projectType: 'unknown' }), WS_ID)
    expect(input.type).toBe('generic')
  })

  it('args 引用不与原 project 共享，避免 UI 后续改动串味', () => {
    const project = baseProject({ args: ['run', 'dev'] })
    const input = toServiceInput(project, WS_ID)

    expect(input.args).not.toBe(project.args)
    input.args!.push('--host')
    expect(project.args).toEqual(['run', 'dev'])
  })
})

describe('toServiceInput — command 回落', () => {
  it('command 缺失时回落 npm（保证 Zod min(1) 通过）', () => {
    expect(toServiceInput(baseProject(), WS_ID).command).toBe('npm')
  })

  it('command 为空串 / 纯空白时同样回落 npm', () => {
    expect(toServiceInput(baseProject({ command: '' }), WS_ID).command).toBe('npm')
    expect(toServiceInput(baseProject({ command: '   ' }), WS_ID).command).toBe('npm')
  })

  it('command 有值时 trim 后保留', () => {
    expect(toServiceInput(baseProject({ command: '  mvnw  ' }), WS_ID).command).toBe('mvnw')
  })
})

describe('toServiceInput — packageManager 枚举收敛', () => {
  it.each(['npm', 'pnpm', 'yarn', 'bun'] as const)('%s 属于 Service 枚举，透传', (pm) => {
    expect(toServiceInput(baseProject({ packageManager: pm }), WS_ID).packageManager).toBe(pm)
  })

  it.each(['maven', 'gradle', 'cargo', ''])(
    '%s 不在 Service 枚举内，省略该字段而非塞 custom',
    (pm) => {
      const input = toServiceInput(baseProject({ packageManager: pm }), WS_ID)
      expect(isOmitted(input as unknown as Record<string, unknown>, 'packageManager')).toBe(true)
    },
  )

  it('packageManager 未提供时省略', () => {
    const input = toServiceInput(baseProject(), WS_ID)
    expect(isOmitted(input as unknown as Record<string, unknown>, 'packageManager')).toBe(true)
  })
})

describe('toServiceInput — port 校验（Phase 4 才会有值）', () => {
  it('合法端口透传', () => {
    expect(toServiceInput(baseProject({ detectedPort: 5173 }), WS_ID).port).toBe(5173)
    expect(toServiceInput(baseProject({ detectedPort: 1 }), WS_ID).port).toBe(1)
    expect(toServiceInput(baseProject({ detectedPort: 65535 }), WS_ID).port).toBe(65535)
  })

  it.each([0, -1, 65536, 3000.5, Number.NaN])('非法端口 %s 一律省略', (port) => {
    const input = toServiceInput(baseProject({ detectedPort: port }), WS_ID)
    expect(isOmitted(input as unknown as Record<string, unknown>, 'port')).toBe(true)
  })

  it('detectedPort 未提供时省略（Phase 1/2 的常态）', () => {
    const input = toServiceInput(baseProject(), WS_ID)
    expect(isOmitted(input as unknown as Record<string, unknown>, 'port')).toBe(true)
  })
})

describe('toServiceInput — discovery 元数据（Phase 6 预埋）', () => {
  it('managed 恒为 true，sourcePath 取项目绝对路径，lastDetectedAt 用传入时间戳', () => {
    const input = toServiceInput(baseProject(), WS_ID, 1700000000000)

    expect(input.discovery).toEqual({
      managed: true,
      lastDetectedAt: 1700000000000,
      sourcePath: 'D:/proj/web',
    })
  })

  it('不传 detectedAt 时用当前时间', () => {
    const before = Date.now()
    const input = toServiceInput(baseProject(), WS_ID)
    const after = Date.now()

    expect(input.discovery!.lastDetectedAt).toBeGreaterThanOrEqual(before)
    expect(input.discovery!.lastDetectedAt).toBeLessThanOrEqual(after)
  })

  it('Phase 3 不写 lockedFields，留给 Phase 6 重扫合并使用', () => {
    const input = toServiceInput(baseProject(), WS_ID)
    expect(isOmitted(input.discovery as unknown as Record<string, unknown>, 'lockedFields')).toBe(
      true,
    )
  })
})

describe('toServiceInput — 纯数据保证（跨 contextBridge）', () => {
  it('入参是 reactive/ref 时产出已剥离 Proxy 且可 structuredClone', () => {
    const project = reactive(
      baseProject({ command: 'pnpm', args: ['dev'], packageManager: 'pnpm' }),
    ) as DiscoveredProject
    const input = toServiceInput(project, WS_ID, 1700000000000)

    expect(isProxy(input)).toBe(false)
    expect(isProxy(input.args)).toBe(false)
    expect(isProxy(input.discovery)).toBe(false)
    expect(() => structuredClone(input)).not.toThrow()
  })

  it('project 字段被 ref 包裹时也能正确解包', () => {
    const project = baseProject()
    // 模拟 UI 列表里混入 ref 的极端情况
    const wrapped = reactive({ ...project, name: ref('web-ref') }) as unknown as DiscoveredProject

    const input = toServiceInput(wrapped, WS_ID)
    expect(input.name).toBe('web-ref')
    expect(() => structuredClone(input)).not.toThrow()
  })
})

describe('toServiceInput — 与 Zod schema 契约对齐', () => {
  it('映射结果能通过 CreateServiceSchema（applyDiscovery 的单条校验）', () => {
    const input = toServiceInput(
      baseProject({
        suggestedServiceType: 'node',
        command: 'npm',
        args: ['run', 'start'],
        packageManager: 'npm',
        detectedPort: 3000,
      }),
      WS_ID,
      1700000000000,
    )

    const parsed = CreateServiceSchema.parse(input)
    expect(parsed.discovery).toEqual({
      managed: true,
      lastDetectedAt: 1700000000000,
      sourcePath: 'D:/proj/web',
    })
  })

  it('最小映射（无 args/port/packageManager）同样通过校验', () => {
    expect(() => CreateServiceSchema.parse(toServiceInput(baseProject(), WS_ID))).not.toThrow()
  })
})

describe('toServiceInputs — 批量映射', () => {
  it('顺序与入参一致，且共用同一个 detectedAt', () => {
    const projects = [
      baseProject({ id: 'p1', name: 'web', path: 'D:/proj/web', suggestedServiceType: 'frontend' }),
      baseProject({ id: 'p2', name: 'api', path: 'D:/proj/api', suggestedServiceType: 'node' }),
      baseProject({ id: 'p3', name: 'svc', path: 'D:/proj/svc', suggestedServiceType: 'java' }),
    ]

    const inputs = toServiceInputs(projects, WS_ID, 1700000000000)

    expect(inputs.map((i) => i.name)).toEqual(['web', 'api', 'svc'])
    expect(inputs.map((i) => i.cwd)).toEqual(['D:/proj/web', 'D:/proj/api', 'D:/proj/svc'])
    expect(inputs.map((i) => i.type)).toEqual(['frontend', 'node', 'java'])
    expect(inputs.every((i) => i.discovery!.lastDetectedAt === 1700000000000)).toBe(true)
  })

  it('批量结果能整体通过 ApplyDiscoverySchema', () => {
    const inputs = toServiceInputs(
      [baseProject({ id: 'p1', name: 'web' }), baseProject({ id: 'p2', name: 'api' })],
      WS_ID,
    )

    const parsed = ApplyDiscoverySchema.parse({ workspaceId: WS_ID, services: inputs })
    expect(parsed.services).toHaveLength(2)
    expect(parsed.services.every((s) => s.discovery?.managed === true)).toBe(true)
  })

  it('空数组返回空数组（UI 层负责拦截，schema 层再兜一次 min(1)）', () => {
    expect(toServiceInputs([], WS_ID)).toEqual([])
    expect(() => ApplyDiscoverySchema.parse({ workspaceId: WS_ID, services: [] })).toThrow()
  })
})

// PX Dev — api 层统一守卫的全量覆盖测试
//
// 已有的 WorkspaceCreateIpc.test.ts 只验证了 `service.list` 一个方法，
// 无法证明守卫对「所有命名空间 / 多实参 / 零实参 / 返回值」都成立。
// 本文件补齐这部分，确保未来新增方法或重构守卫实现时不会静默退化。
//
// 断言口径统一为：抵达 contextBridge 的每个实参都必须能通过 structuredClone，
// 这与 Electron ipcRenderer.invoke 的失败条件完全一致。
//
// ⚠️ 关键回归约束（曾经踩过的坑）：
// 真实的 contextBridge.exposeInMainWorld 注入主世界的对象是**深度冻结**的
// （每个属性 writable:false + configurable:false）。早期这里的假 bridge 是
// 普通可写对象，导致「守卫用 Proxy 实现」这一致命缺陷完全测不出来 ——
// Proxy 不变式禁止 get 陷阱为「不可写且不可配置」的属性返回包装值，
// 线上一读取 api.system 就同步抛 TypeError，所有 IPC 调用全线失效。
// 因此下面的 installFakeBridge() **必须** deepFreeze，保持与真实环境同构。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive } from 'vue'

/** 一次方法调用的记录 */
interface CallRecord {
  path: string
  args: unknown[]
}

let calls: CallRecord[] = []

/** 所有命名空间及其方法名，与 src/preload/api.ts 的 PxDevAPI 保持一致 */
const BRIDGE_SHAPE: Record<string, string[]> = {
  // discover / applyDiscovery 为 Workspace Discovery Phase 3 新增
  workspace: [
    'list',
    'create',
    'update',
    'delete',
    'discover',
    'applyDiscovery',
    'getRuntimeEndpoints',
  ],
  service: ['list', 'create', 'update', 'delete'],
  process: [
    'start',
    'stop',
    'restart',
    'forceKill',
    'getRuntime',
    'startWorkspace',
    'stopWorkspace',
    'stopAll',
  ],
  log: ['subscribe', 'unsubscribe', 'clear', 'history', 'export'],
  environment: ['detect', 'detectSingle'],
  port: ['check', 'owner', 'kill', 'waitListening'],
  system: [
    'openPath',
    'openExternal',
    'selectDirectory',
    'scanDirectory',
    'showItemInFolder',
    // detectProject 为 Workspace Discovery Phase 3 新增
    'detectProject',
  ],
  app: ['getSettings', 'updateSettings', 'getVersion', 'quit', 'minimize'],
}

/**
 * 深度冻结对象，复刻 contextBridge.exposeInMainWorld 的真实行为。
 * 冻结后所有属性均为 writable:false + configurable:false。
 */
function deepFreeze<T extends object>(target: T): T {
  for (const key of Object.getOwnPropertyNames(target)) {
    const value = (target as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object') {
      deepFreeze(value as object)
    }
  }
  return Object.freeze(target)
}

/**
 * 构造模拟 contextBridge 的 window.pxDev。
 * 每个方法都会对收到的实参逐个 structuredClone —— 复刻真实失败条件。
 * 最后 deepFreeze，与真实 contextBridge 的冻结语义保持一致。
 */
function installFakeBridge(): void {
  const bridge: Record<string, Record<string, unknown>> = {}

  for (const [ns, methods] of Object.entries(BRIDGE_SHAPE)) {
    bridge[ns] = {}
    for (const method of methods) {
      bridge[ns][method] = vi.fn(async (...args: unknown[]) => {
        // 不可克隆时在此抛出，等价于 ipcRenderer.invoke 的行为
        calls.push({ path: `${ns}.${method}`, args: args.map((a) => structuredClone(a)) })
        return { ok: true, path: `${ns}.${method}` }
      })
    }
  }

  // events 单独构造：回调必须保持函数身份，且返回可调用的取消订阅函数
  let unsubscribed = 0
  bridge.events = {
    onLogBatch: vi.fn((cb: unknown) => {
      calls.push({ path: 'events.onLogBatch', args: [cb] })
      return () => {
        unsubscribed += 1
      }
    }),
    onRuntimeChanged: vi.fn((cb: unknown) => {
      calls.push({ path: 'events.onRuntimeChanged', args: [cb] })
      return () => {
        unsubscribed += 1
      }
    }),
    onRuntimeEndpoints: vi.fn((cb: unknown) => {
      calls.push({ path: 'events.onRuntimeEndpoints', args: [cb] })
      return () => {
        unsubscribed += 1
      }
    }),
    __unsubCount: () => unsubscribed,
  }

  // 与真实 contextBridge 同构：深度冻结后再注入
  deepFreeze(bridge)
  ;(globalThis as unknown as { window: unknown }).window = { pxDev: bridge }
}

/** 取出某次调用记录 */
function callOf(path: string): CallRecord {
  const record = calls.find((c) => c.path === path)
  if (!record) {
    throw new Error(`未记录到调用: ${path}（实际: ${calls.map((c) => c.path).join(', ')}）`)
  }
  return record
}

/** api 门面在测试中的宽松形态：命名空间 → 方法名 → 任意签名函数 */
type BridgeApi = Record<string, Record<string, (...a: unknown[]) => unknown>>

/** 动态导入 api 层（每个用例都需在 resetModules 之后重新导入） */
async function loadApi(): Promise<BridgeApi> {
  const mod = await import('@renderer/api')
  return mod.api as unknown as BridgeApi
}

beforeEach(() => {
  calls = []
  vi.resetModules()
  installFakeBridge()
})

/**
 * api 门面（src/renderer/src/api/index.ts）中**不转发任何实参**的方法。
 * 它们的签名就是 `() => getApi().x.y()`，因此不参与「入参净化」扫描，
 * 而是单独断言「调用时不会夹带多余实参」。
 */
const ZERO_ARG_METHODS = new Set([
  'workspace.list',
  'process.stopAll',
  'environment.detect',
  'system.selectDirectory',
  'app.getSettings',
  'app.getVersion',
  'app.quit',
  'app.minimize',
])

/**
 * 全部 9 个 IPC 命名空间的「探针」调用。
 *
 * ⚠️ 为什么必须用「真实调用」而不是 `expect(() => api.system).not.toThrow()`：
 * 导出的 `api` 是 index.ts 里手写的**普通对象字面量门面**，读取 `api.system`
 * 只是读门面自己的属性，压根不会触碰 window.pxDev，因此这种断言在
 * 「守卫是坏的 Proxy 实现」时**照样通过** —— 是彻头彻尾的假绿。
 * 真正会触发守卫的是门面方法体里的 `getApi().<ns>.<method>()`，
 * 所以每个命名空间都必须实际发起一次调用，才能复现 Proxy 不变式事故。
 *
 * events 不在 BRIDGE_SHAPE 里（其方法签名收函数、语义不同），
 * 但它同样是被冻结的命名空间，必须一并纳入回归覆盖。
 */
const NAMESPACE_PROBES: Array<[string, (api: BridgeApi) => unknown]> = [
  ['workspace', (api) => api.workspace.list()],
  ['service', (api) => api.service.list()],
  ['process', (api) => api.process.stopAll()],
  ['log', (api) => api.log.subscribe('svc-probe')],
  ['environment', (api) => api.environment.detect()],
  ['port', (api) => api.port.check(3000)],
  ['system', (api) => api.system.selectDirectory()],
  ['app', (api) => api.app.getVersion()],
  ['events', (api) => api.events.onLogBatch(() => undefined)],
]

describe('统一守卫 — 冻结 bridge 回归（Proxy 不变式事故）', () => {
  // 事故复现口径：contextBridge 暴露的对象被深度冻结时，
  // 任何基于 Proxy 的守卫都会在「读取命名空间属性」这一步同步抛 TypeError：
  //   'get' on proxy: property 'system' is a read-only and non-configurable
  //   data property on the proxy target but the proxy did not return its actual value
  // 现在守卫改为普通对象镜像，下面这些断言必须全部通过。

  it('假 bridge 确实是深度冻结的（保证本组测试有效）', () => {
    const bridge = (globalThis as unknown as { window: { pxDev: Record<string, unknown> } }).window
      .pxDev
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(Object.isFrozen(bridge.system as object)).toBe(true)
    expect(Object.isFrozen(bridge.events as object)).toBe(true)

    const desc = Object.getOwnPropertyDescriptor(bridge, 'system')
    expect(desc?.writable).toBe(false)
    expect(desc?.configurable).toBe(false)
  })

  it('探针覆盖全部 9 个命名空间（防止漏测新命名空间）', () => {
    const covered = NAMESPACE_PROBES.map(([ns]) => ns).sort()
    const expected = [...Object.keys(BRIDGE_SHAPE), 'events'].sort()
    expect(covered).toEqual(expected)
    expect(covered).toHaveLength(9)
  })

  it.each(NAMESPACE_PROBES)(
    '冻结 bridge 下访问命名空间 %s 不触发 Proxy 不变式 TypeError',
    async (ns, probe) => {
      const api = await loadApi()

      // 同步抛出即为事故复现（调用根本活不到 IPC 层）
      let thrown: unknown = null
      try {
        await Promise.resolve(probe(api as unknown as BridgeApi))
      } catch (err) {
        thrown = err
      }

      expect(thrown, `${ns} 命名空间调用不应抛异常，实际: ${String(thrown)}`).toBeNull()
      // 额外锁定错误特征，避免将来有人用「宽松断言」把事故放过去
      expect(String(thrown)).not.toContain('read-only and non-configurable')
    },
  )

  it('冻结 bridge 下 system.selectDirectory 可正常调用（本次 bug 直接现场）', async () => {
    const api = await loadApi()

    await expect(api.system.selectDirectory()).resolves.toEqual({
      ok: true,
      path: 'system.selectDirectory',
    })
  })

  it('冻结 bridge 下所有命名空间的所有方法都可调用', async () => {
    const api = await loadApi()

    for (const [ns, methods] of Object.entries(BRIDGE_SHAPE)) {
      for (const method of methods) {
        await expect(
          Promise.resolve(api[ns][method]()),
          `${ns}.${method} 应可正常调用`,
        ).resolves.toBeDefined()
      }
    }

    // events 的两个方法同样必须可调用（返回取消订阅函数而非 Promise）
    expect(api.events.onLogBatch(() => undefined)).toBeTypeOf('function')
    expect(api.events.onRuntimeChanged(() => undefined)).toBeTypeOf('function')
    expect(api.events.onRuntimeEndpoints(() => undefined)).toBeTypeOf('function')
  })
})

describe('统一守卫 — 全命名空间扫描', () => {
  // 逐个命名空间/方法传入响应式对象，证明守卫对「任意会转发实参的方法」都生效，
  // 而不只是恰好写了 toPlain 的那几个。
  const cases: Array<[string, string]> = Object.entries(BRIDGE_SHAPE)
    .flatMap(([ns, methods]) => methods.map((m) => [ns, m] as [string, string]))
    .filter(([ns, m]) => !ZERO_ARG_METHODS.has(`${ns}.${m}`))

  it.each(cases)('%s.%s 的响应式入参会被自动净化', async (ns, method) => {
    const api = await loadApi()

    // 深层嵌套：reactive 里套 ref、数组、对象
    const nested = ref({ deep: true })
    const arg = reactive({
      id: 'x-1',
      nested,
      list: [reactive({ a: 1 }), ref('two')],
      meta: { createdAt: 'now' },
    })

    await expect(api[ns][method](arg)).resolves.toBeDefined()

    const record = callOf(`${ns}.${method}`)
    expect(record.args[0]).toEqual({
      id: 'x-1',
      nested: { deep: true },
      list: [{ a: 1 }, 'two'],
      meta: { createdAt: 'now' },
    })
  })
})

describe('统一守卫 — 实参保真性', () => {
  it('多实参方法的顺序与值不被破坏', async () => {
    const api = await loadApi()

    await api.log.history('svc-1', 500)
    expect(callOf('log.history').args).toEqual(['svc-1', 500])

    await api.log.export('svc-2', 'D:\\logs\\out.log')
    expect(callOf('log.export').args).toEqual(['svc-2', 'D:\\logs\\out.log'])

    await api.port.waitListening(3000, 15000)
    expect(callOf('port.waitListening').args).toEqual([3000, 15000])
  })

  it('零实参门面方法不会夹带任何实参（即使调用方误传）', async () => {
    const api = await loadApi()

    // 门面签名固定为 () => ...，多余实参在门面层就被丢弃，压根到不了 bridge
    await api.workspace.list(reactive({ shouldBeDropped: true }))
    expect(callOf('workspace.list').args).toHaveLength(0)

    await api.app.quit(reactive({ shouldBeDropped: true }))
    expect(callOf('app.quit').args).toHaveLength(0)

    await api.environment.detect()
    expect(callOf('environment.detect').args).toHaveLength(0)
  })

  it('可选实参缺省时转发为 undefined，且仍可安全跨 IPC', async () => {
    const api = await loadApi()

    // 门面写法是 (workspaceId?) => getApi().service.list(workspaceId)，
    // 因此缺省时会显式转发一个 undefined —— structuredClone 支持 undefined，安全。
    await api.service.list()
    expect(callOf('service.list').args).toEqual([undefined])

    await api.process.getRuntime()
    expect(callOf('process.getRuntime').args).toEqual([undefined])
  })

  it('显式传入 undefined 仍保持 undefined（不被转成 null 或对象）', async () => {
    const api = await loadApi()

    await api.log.history('svc-3', undefined)
    expect(callOf('log.history').args).toEqual(['svc-3', undefined])
  })

  it('零实参方法可正常调用并原样返回结果', async () => {
    const api = await loadApi()

    await expect(api.system.selectDirectory()).resolves.toEqual({
      ok: true,
      path: 'system.selectDirectory',
    })
    expect(callOf('system.selectDirectory').args).toHaveLength(0)

    await expect(api.app.getVersion()).resolves.toEqual({
      ok: true,
      path: 'app.getVersion',
    })
  })

  it('基本类型实参不被 toPlain 改写', async () => {
    const api = await loadApi()

    await api.port.kill(12345)
    expect(callOf('port.kill').args).toEqual([12345])

    await api.workspace.delete('ws-abc')
    expect(callOf('workspace.delete').args).toEqual(['ws-abc'])
  })
})

describe('统一守卫 — 事件回调必须原样透传', () => {
  it('onLogBatch / onRuntimeChanged / onRuntimeEndpoints 的回调保持函数身份', async () => {
    const api = await loadApi()

    const logCb = (): void => undefined
    const runtimeCb = (): void => undefined
    const endpointCb = (): void => undefined

    api.events.onLogBatch(logCb)
    api.events.onRuntimeChanged(runtimeCb)
    api.events.onRuntimeEndpoints(endpointCb)

    expect(callOf('events.onLogBatch').args[0]).toBe(logCb)
    expect(callOf('events.onRuntimeChanged').args[0]).toBe(runtimeCb)
    expect(callOf('events.onRuntimeEndpoints').args[0]).toBe(endpointCb)
  })

  it('订阅返回的取消函数可被正常调用', async () => {
    const api = await loadApi()

    const off = api.events.onLogBatch(() => undefined) as unknown as () => void
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })
})

describe('统一守卫 — 缓存与重绑定', () => {
  it('同一 bridge 多次调用均可用（缓存命中不影响正确性）', async () => {
    const api = await loadApi()

    await api.workspace.create(reactive({ name: 'a' }))
    await api.workspace.create(reactive({ name: 'b' }))

    const created = calls.filter((c) => c.path === 'workspace.create')
    expect(created).toHaveLength(2)
    expect(created[0].args[0]).toEqual({ name: 'a' })
    expect(created[1].args[0]).toEqual({ name: 'b' })
  })

  it('window.pxDev 被替换后守卫会重新绑定到新 bridge', async () => {
    const api = await loadApi()

    await api.workspace.create(reactive({ name: 'old-bridge' }))
    expect(callOf('workspace.create').args[0]).toEqual({ name: 'old-bridge' })

    // 模拟 preload 重新注入（如窗口重载）
    calls = []
    installFakeBridge()

    await api.workspace.create(reactive({ name: 'new-bridge' }))
    expect(callOf('workspace.create').args[0]).toEqual({ name: 'new-bridge' })
  })
})

describe('统一守卫 — 真实场景回归', () => {
  it('服务表单（含 args / env / healthCheck 嵌套）可安全送达', async () => {
    const api = await loadApi()

    const form = ref({
      workspaceId: 'ws-1',
      name: 'api-server',
      type: 'node' as const,
      cwd: 'D:\\Coding\\project\\api',
      command: 'npm',
      args: ['run', 'dev'],
      env: { NODE_ENV: 'development', PORT: '3000' },
      healthCheck: { type: 'http' as const, target: 'http://localhost:3000', retries: 3 },
      enabled: true,
      dependencies: [],
      shellMode: false,
    })

    // 直接把 ref.value（reactive Proxy）丢进去 —— 这正是 ServiceEditDrawer 的写法
    await expect(api.service.create(form.value)).resolves.toBeDefined()

    expect(callOf('service.create').args[0]).toEqual({
      workspaceId: 'ws-1',
      name: 'api-server',
      type: 'node',
      cwd: 'D:\\Coding\\project\\api',
      command: 'npm',
      args: ['run', 'dev'],
      env: { NODE_ENV: 'development', PORT: '3000' },
      healthCheck: { type: 'http', target: 'http://localhost:3000', retries: 3 },
      enabled: true,
      dependencies: [],
      shellMode: false,
    })
  })

  it('设置页 reactive 对象可安全送达', async () => {
    const api = await loadApi()

    const settings = reactive({
      theme: 'dark',
      closeBehavior: 'tray',
      maxLogLines: 5000,
      startMinimized: false,
    })

    await expect(api.app.updateSettings(settings)).resolves.toBeDefined()
    expect(callOf('app.updateSettings').args[0]).toEqual({
      theme: 'dark',
      closeBehavior: 'tray',
      maxLogLines: 5000,
      startMinimized: false,
    })
  })
})

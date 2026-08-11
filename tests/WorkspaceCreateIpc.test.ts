// PX Dev — 创建工作区 IPC 序列化回归测试
// 覆盖 bug：创建工作区弹窗点「创建」报 `An object could not be cloned.`
//
// 该用例完整模拟真实调用链：
//   ref(form) -> Pinia action -> renderer api 层 -> contextBridge -> structuredClone
// 其中 structuredClone 等价于 Electron ipcRenderer.invoke 的参数序列化行为。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { CreateWorkspaceSchema } from '@shared/schemas/ipc.schema'

/** 记录最终抵达「IPC 边界」的原始参数，便于断言 */
let lastCreatePayload: unknown = null
/** 记录 service.list 收到的原始参数（该方法在 api 层没有显式 toPlain，用于验证统一守卫） */
let lastServiceListArg: unknown = null
/** 记录 events.onLogBatch 收到的回调，用于验证函数没有被误净化 */
let lastLogCallback: unknown = null

/**
 * 构造一个模拟 preload/contextBridge 的 window.pxDev。
 * 各方法在收到参数时立刻执行 structuredClone，
 * 完全复刻 ipcRenderer.invoke 的失败条件。
 */
function installFakeBridge(): void {
  const bridge = {
    workspace: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input: unknown) => {
        // 等价于 ipcRenderer.invoke 的结构化克隆，不可克隆时抛 DataCloneError
        lastCreatePayload = structuredClone(input)
        return {
          id: 'ws-1',
          name: (input as { name: string }).name,
          favorite: false,
          startMode: 'parallel',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        }
      }),
      update: vi.fn(async (input: unknown) => structuredClone(input)),
      delete: vi.fn(async () => ({ success: true })),
    },
    service: {
      list: vi.fn(async (arg: unknown) => {
        lastServiceListArg = structuredClone(arg)
        return []
      }),
      create: vi.fn(async (input: unknown) => structuredClone(input)),
      update: vi.fn(async (input: unknown) => structuredClone(input)),
      delete: vi.fn(async () => ({ success: true })),
    },
    events: {
      onLogBatch: vi.fn((cb: unknown) => {
        lastLogCallback = cb
        return () => undefined
      }),
      onRuntimeChanged: vi.fn(() => () => undefined),
    },
  }

  // 测试环境为 node，需要手动补一个 window
  ;(globalThis as unknown as { window: unknown }).window = { pxDev: bridge }
}

describe('创建工作区 — 跨 IPC 边界的序列化', () => {
  beforeEach(() => {
    lastCreatePayload = null
    lastServiceListArg = null
    lastLogCallback = null
    installFakeBridge()
    setActivePinia(createPinia())
    vi.resetModules()
  })

  it('复现前提：未处理的 form.value 是 Proxy，直接克隆必失败', () => {
    const form = ref({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel' as const,
    })

    expect(() => structuredClone(form.value)).toThrow(/could not be cloned/)
  })

  it('走完整链路：Modal -> Pinia store -> api -> IPC，不应抛克隆错误', async () => {
    const { useWorkspaceStore } = await import('@renderer/stores/workspaceStore')
    const store = useWorkspaceStore()

    // 与 WorkspaceCreateModal.vue 中的 form 完全一致
    const form = ref({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel' as const,
    })

    // 这正是 handleSave 里的调用：await workspaceStore.createWorkspace(...)
    await expect(store.createWorkspace(form.value)).resolves.toBeTruthy()

    expect(lastCreatePayload).toEqual({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel',
    })
  })

  it('api 层直接调用同样应产出可克隆的纯数据', async () => {
    const { api } = await import('@renderer/api')
    const form = ref({ name: 'demo', favorite: false, startMode: 'parallel' as const })

    await expect(api.workspace.create(form.value)).resolves.toBeTruthy()
    expect(() => structuredClone(lastCreatePayload)).not.toThrow()
  })
})

describe('api 层统一守卫 — 防止「新增方法忘记 toPlain」再次引入同类 bug', () => {
  beforeEach(() => {
    lastCreatePayload = null
    lastServiceListArg = null
    lastLogCallback = null
    installFakeBridge()
    setActivePinia(createPinia())
    vi.resetModules()
  })

  it('即使方法本身没写 toPlain，响应式入参也会被自动净化', async () => {
    const { api } = await import('@renderer/api')

    // service.list 在 api 层是直接透传的（没有显式 toPlain），
    // 传入一个响应式对象来验证 getApi() 出口守卫确实生效
    const reactiveArg = reactive({ workspaceId: 'ws-1' })
    await expect(
      api.service.list(reactiveArg as unknown as string),
    ).resolves.toBeDefined()

    expect(lastServiceListArg).toEqual({ workspaceId: 'ws-1' })
  })

  it('事件回调函数必须原样透传，不能被 toPlain 变成 undefined', async () => {
    const { api } = await import('@renderer/api')

    const callback = (): void => undefined
    api.events.onLogBatch(callback)

    expect(typeof lastLogCallback).toBe('function')
    expect(lastLogCallback).toBe(callback)
  })
})

describe('CreateWorkspaceSchema — 可选字段留空时的校验行为', () => {
  it('rootPath 传空串会被拒绝（必须省略该字段）', () => {
    const result = CreateWorkspaceSchema.safeParse({
      name: 'demo',
      description: '',
      rootPath: '',
      color: '#2b8cff',
      favorite: false,
      startMode: 'parallel',
    })

    expect(result.success).toBe(false)
  })

  it('省略 rootPath / description 时校验通过', () => {
    const result = CreateWorkspaceSchema.safeParse({
      name: 'demo',
      color: '#2b8cff',
      favorite: false,
      startMode: 'parallel',
    })

    expect(result.success).toBe(true)
  })

  it('填写了根目录时校验通过', () => {
    const result = CreateWorkspaceSchema.safeParse({
      name: 'pxczxn',
      description: '星语社区',
      rootPath: 'D:\\Coding\\project\\java-code\\pxczxn',
      color: '#2b8cff',
      favorite: true,
      startMode: 'parallel',
    })

    expect(result.success).toBe(true)
  })
})

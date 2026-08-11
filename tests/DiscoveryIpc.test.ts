// PX Dev — Workspace Discovery Phase 3 IPC 链路测试
//
// 覆盖三个新增通道：
//   workspace:discover       → WorkspaceDiscoveryResult（纯数据、经 strict schema 净化）
//   workspace:applyDiscovery → Service[]（批量创建 + **单次落盘** + discovery 元数据）
//   system:detectProject     → DiscoveredProject | null（单目录轻量检测）
//
// 断言口径：
// 1. 出参必须能通过 structuredClone（等价 Electron IPC 的序列化条件）；
// 2. applyDiscovery 无论创建几个 Service，configManager.save 都只能被调用 **1 次**；
// 3. 新建 Service 的 discovery.managed 必须为 true（Phase 6 重扫比对的前提）；
// 4. 手动 createService 不得凭空长出 discovery 字段（对旧配置零影响）。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import type { AppConfig, DiscoveredProject, WorkspaceDiscoveryResult } from '@shared/types'
import type { ConfigManager } from '@main/managers/ConfigManager'

// ============ Electron 模块 Mock ============
// vi.mock 会被提升到文件顶部，共享状态必须通过 vi.hoisted 创建
const { handlers, ipcRendererMock } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  ipcRendererMock: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  ipcRenderer: ipcRendererMock,
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

// mock 生效后再导入被测模块
const { registerDiscoveryHandlers } = await import('@main/ipc/discovery.ipc')
const { WorkspaceManager } = await import('@main/managers/WorkspaceManager')
const { DiscoveryError } = await import('@main/discovery')
const { createPxDevAPI } = await import('../src/preload/api')

type WorkspaceManagerType = InstanceType<typeof WorkspaceManager>

// ============ 测试夹具 ============

const WORKSPACE_ID = 'ws-discovery-1'
const fakeEvent = { sender: { id: 1 } }

/** 构造一个最小可用的 DiscoveredProject */
function makeProject(overrides: Partial<DiscoveredProject> = {}): DiscoveredProject {
  return {
    id: 'p-web',
    path: 'D:\\root\\web',
    relativePath: 'web',
    name: 'web',
    projectType: 'frontend',
    framework: 'vite',
    packageManager: 'pnpm',
    command: 'pnpm',
    args: ['run', 'dev'],
    isLibrary: false,
    suggestedServiceType: 'frontend',
    suggestedSelected: true,
    confidence: 'high',
    evidence: [{ type: 'marker-file', detail: '发现项目标记文件 package.json', source: 'package.json' }],
    configFiles: ['package.json'],
    ...overrides,
  }
}

/** 构造一份发现结果 */
function makeResult(projects: DiscoveredProject[]): WorkspaceDiscoveryResult {
  return {
    rootPath: 'D:\\root',
    scannedAt: 1_700_000_000_000,
    projects,
    warnings: [],
    stats: {
      scannedDirectories: 4,
      maxDepthReached: 1,
      truncated: false,
      elapsedMs: 12,
      skippedDirectories: 1,
    },
  }
}

/** 内存版 ConfigManager 替身：get() 返回同一个引用，save() 计数 */
function createFakeConfigManager(): { configManager: ConfigManager; save: ReturnType<typeof vi.fn> } {
  const config: AppConfig = {
    version: 1,
    settings: {
      theme: 'dark',
      closeBehavior: 'tray',
      maxLogLines: 5000,
      startMinimized: false,
      autoRestoreLastSession: false,
      startupInterval: 1000,
      showTimestamp: true,
      defaultBrowser: 'system',
    },
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: 'Discovery WS',
        favorite: false,
        startMode: 'parallel',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    services: [],
  }

  const save = vi.fn()
  const configManager = {
    get: () => config,
    save,
  } as unknown as ConfigManager

  return { configManager, save }
}

/** 伪造的 WorkspaceDiscoveryManager，只保留 discover() */
function createFakeDiscoveryManager(): { manager: never; discover: ReturnType<typeof vi.fn> } {
  const discover = vi.fn()
  return { manager: { discover } as never, discover }
}

let workspaceManager: WorkspaceManagerType
let saveMock: ReturnType<typeof vi.fn>
let discoverMock: ReturnType<typeof vi.fn>

function handlerOf(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`${channel} handler 未注册`)
  return handler as (...args: unknown[]) => Promise<unknown>
}

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()

  const fakeConfig = createFakeConfigManager()
  saveMock = fakeConfig.save
  workspaceManager = new WorkspaceManager(fakeConfig.configManager)

  const fakeDiscovery = createFakeDiscoveryManager()
  discoverMock = fakeDiscovery.discover

  registerDiscoveryHandlers(fakeDiscovery.manager, workspaceManager)
})

// ============ 通道注册 ============

describe('Discovery IPC — 通道注册', () => {
  it('① 三个通道名与常量一致，且全部注册成功', () => {
    expect(IPC_CHANNELS.WORKSPACE_DISCOVER).toBe('workspace:discover')
    expect(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY).toBe('workspace:applyDiscovery')
    expect(IPC_CHANNELS.SYSTEM_DETECT_PROJECT).toBe('system:detectProject')

    expect(handlers.has('workspace:discover')).toBe(true)
    expect(handlers.has('workspace:applyDiscovery')).toBe(true)
    expect(handlers.has('system:detectProject')).toBe(true)
  })
})

// ============ workspace:discover ============

describe('workspace:discover', () => {
  it('② 返回结构化发现结果，且可 structuredClone', async () => {
    discoverMock.mockResolvedValue(makeResult([makeProject()]))

    const result = (await handlerOf(IPC_CHANNELS.WORKSPACE_DISCOVER)(fakeEvent, {
      rootPath: 'D:\\root',
    })) as WorkspaceDiscoveryResult

    expect(result.rootPath).toBe('D:\\root')
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]).toMatchObject({
      id: 'p-web',
      name: 'web',
      projectType: 'frontend',
      framework: 'vite',
      command: 'pnpm',
      args: ['run', 'dev'],
      suggestedServiceType: 'frontend',
      suggestedSelected: true,
      confidence: 'high',
    })
    expect(result.stats.truncated).toBe(false)
    expect(() => structuredClone(result)).not.toThrow()
  })

  it('③ 透传 options（maxDepth / includeLibrary）给 discoveryManager', async () => {
    discoverMock.mockResolvedValue(makeResult([]))

    await handlerOf(IPC_CHANNELS.WORKSPACE_DISCOVER)(fakeEvent, {
      rootPath: 'D:\\root',
      options: { maxDepth: 5, includeLibrary: true },
    })

    expect(discoverMock).toHaveBeenCalledTimes(1)
    const [rootPath, options] = discoverMock.mock.calls[0]
    expect(rootPath).toBe('D:\\root')
    expect(options).toMatchObject({ maxDepth: 5, includeLibrary: true })
  })

  // WorkspaceDiscoveryResultSchema 全链路 .strict()：多余键不是被静默剥离，
  // 而是直接判定失败。这正是我们要的 fail-fast —— 与其把可能不可克隆的
  // 内部句柄（fd / ChildProcess / FSWatcher）漏给渲染层触发
  // `An object could not be cloned.`，不如在 main 侧当场报错。
  it('④ manager 多返回非法键时出参校验失败，绝不把内部句柄漏给渲染层', async () => {
    const polluted = makeResult([makeProject()]) as unknown as Record<string, unknown>
    polluted.__internalHandle = { fd: 7 }
    ;(polluted.projects as Record<string, unknown>[])[0].__scannerRef = { anything: true }
    discoverMock.mockResolvedValue(polluted)

    const err = await handlerOf(IPC_CHANNELS.WORKSPACE_DISCOVER)(fakeEvent, {
      rootPath: 'D:\\root',
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as { code: string }).code).toBe('INTERNAL_ERROR')
    expect((err as Error).message).toContain('__internalHandle')
  })

  it('④b 合法出参逐字段透传，不丢 evidence / stats / warnings', async () => {
    discoverMock.mockResolvedValue(makeResult([makeProject()]))

    const result = (await handlerOf(IPC_CHANNELS.WORKSPACE_DISCOVER)(fakeEvent, {
      rootPath: 'D:\\root',
    })) as Record<string, unknown>

    const project = (result.projects as Record<string, unknown>[])[0]
    expect(project.evidence).toHaveLength(1)
    expect(result.stats).toBeTruthy()
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('⑤ rootPath 缺失 → 参数校验失败', async () => {
    await expect(handlerOf(IPC_CHANNELS.WORKSPACE_DISCOVER)(fakeEvent, {})).rejects.toThrow(
      /参数校验失败/,
    )
    expect(discoverMock).not.toHaveBeenCalled()
  })

  it('⑥ DiscoveryError 被转成带原始错误码的 IpcError', async () => {
    discoverMock.mockRejectedValue(
      new DiscoveryError('DISCOVERY_ROOT_NOT_FOUND', '扫描根目录不存在：D:\\nope'),
    )

    const err = await handlerOf(IPC_CHANNELS.WORKSPACE_DISCOVER)(fakeEvent, {
      rootPath: 'D:\\nope',
    }).catch((e: unknown) => e)

    expect((err as { code: string }).code).toBe('DISCOVERY_ROOT_NOT_FOUND')
    expect((err as Error).message).toContain('扫描根目录不存在')
  })
})

// ============ workspace:applyDiscovery ============

describe('workspace:applyDiscovery', () => {
  /** 构造 N 条合法的批量创建入参 */
  function makeInputs(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, i) => ({
      workspaceId: WORKSPACE_ID,
      name: `svc-${i}`,
      type: 'node',
      cwd: `D:\\root\\svc-${i}`,
      command: 'npm',
      args: ['run', 'dev'],
      discovery: { managed: true, sourcePath: `D:\\root\\svc-${i}` },
    }))
  }

  it('⑦ 批量创建 N 个 Service，且 configManager.save 只被调用一次', async () => {
    const created = (await handlerOf(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY)(fakeEvent, {
      workspaceId: WORKSPACE_ID,
      services: makeInputs(3),
    })) as { id: string; name: string }[]

    expect(created).toHaveLength(3)
    expect(created.map((s) => s.name)).toEqual(['svc-0', 'svc-1', 'svc-2'])
    // 核心断言：单次原子写，而不是 N 次
    expect(saveMock).toHaveBeenCalledTimes(1)
    // 全部 Service 都进了同一次落盘的 config
    expect(workspaceManager.listServices(WORKSPACE_ID)).toHaveLength(3)
  })

  it('⑧ 每个新建 Service 都带 discovery.managed === true 与 sourcePath', async () => {
    const created = (await handlerOf(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY)(fakeEvent, {
      workspaceId: WORKSPACE_ID,
      services: makeInputs(2),
    })) as { cwd: string; discovery?: { managed: boolean; lastDetectedAt?: number; sourcePath?: string } }[]

    for (const svc of created) {
      expect(svc.discovery).toBeDefined()
      expect(svc.discovery?.managed).toBe(true)
      expect(typeof svc.discovery?.lastDetectedAt).toBe('number')
      expect(svc.discovery?.sourcePath).toBe(svc.cwd)
    }
  })

  it('⑨ 渲染层伪造的 managed:false / 跨工作区 workspaceId 会被 main 侧校正', async () => {
    const created = (await handlerOf(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY)(fakeEvent, {
      workspaceId: WORKSPACE_ID,
      services: [
        {
          workspaceId: 'ws-somewhere-else',
          name: 'evil',
          type: 'node',
          cwd: 'D:\\root\\evil',
          command: 'npm',
          discovery: { managed: false },
        },
      ],
    })) as { workspaceId: string; discovery?: { managed: boolean } }[]

    expect(created[0].workspaceId).toBe(WORKSPACE_ID)
    expect(created[0].discovery?.managed).toBe(true)
  })

  it('⑩ 出参为纯数据，可 structuredClone', async () => {
    const created = await handlerOf(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY)(fakeEvent, {
      workspaceId: WORKSPACE_ID,
      services: makeInputs(2),
    })

    expect(() => structuredClone(created)).not.toThrow()
  })

  it('⑪ 工作区不存在 → 抛错且完全不落盘', async () => {
    await expect(
      handlerOf(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY)(fakeEvent, {
        workspaceId: 'ws-not-exist',
        services: makeInputs(1),
      }),
    ).rejects.toThrow(/Workspace not found/)

    expect(saveMock).not.toHaveBeenCalled()
    expect(workspaceManager.listServices()).toHaveLength(0)
  })

  it('⑫ services 为空数组 → 参数校验失败（避免无意义写盘）', async () => {
    await expect(
      handlerOf(IPC_CHANNELS.WORKSPACE_APPLY_DISCOVERY)(fakeEvent, {
        workspaceId: WORKSPACE_ID,
        services: [],
      }),
    ).rejects.toThrow(/参数校验失败/)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('⑬ 手动 createService 不会凭空长出 discovery 字段（旧配置零影响）', () => {
    const svc = workspaceManager.createService({
      workspaceId: WORKSPACE_ID,
      name: 'manual',
      type: 'node',
      cwd: 'D:\\root\\manual',
      command: 'npm',
    })

    expect(svc.discovery).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(svc, 'discovery')).toBe(false)
  })
})

// ============ system:detectProject ============

describe('system:detectProject', () => {
  it('⑭ 命中目录自身 → 返回该 DiscoveredProject', async () => {
    discoverMock.mockResolvedValue(
      makeResult([makeProject({ id: 'p-self', relativePath: '.', name: 'root', path: 'D:\\root' })]),
    )

    const result = (await handlerOf(IPC_CHANNELS.SYSTEM_DETECT_PROJECT)(fakeEvent, {
      path: 'D:\\root',
    })) as DiscoveredProject | null

    expect(result).not.toBeNull()
    expect(result?.id).toBe('p-self')
    expect(result?.relativePath).toBe('.')
    expect(() => structuredClone(result)).not.toThrow()
  })

  it('⑮ 目录自身不是项目 → 返回 null（不返回子目录结果）', async () => {
    discoverMock.mockResolvedValue(makeResult([makeProject({ relativePath: 'web' })]))

    const result = await handlerOf(IPC_CHANNELS.SYSTEM_DETECT_PROJECT)(fakeEvent, {
      path: 'D:\\root',
    })

    expect(result).toBeNull()
  })

  it('⑯ 使用 maxDepth=0 调用 discover，保证只看目录自身', async () => {
    discoverMock.mockResolvedValue(makeResult([]))

    await handlerOf(IPC_CHANNELS.SYSTEM_DETECT_PROJECT)(fakeEvent, { path: 'D:\\root' })

    const [, options] = discoverMock.mock.calls[0]
    expect(options).toMatchObject({ maxDepth: 0, includeLibrary: true })
  })

  it('⑰ path 缺失 → 参数校验失败', async () => {
    await expect(
      handlerOf(IPC_CHANNELS.SYSTEM_DETECT_PROJECT)(fakeEvent, {}),
    ).rejects.toThrow(/参数校验失败/)
  })
})

// ============ preload 契约 ============

describe('preload 层 discovery 方法契约', () => {
  it('⑱ workspace.discover / applyDiscovery 使用正确通道并透传入参', async () => {
    ipcRendererMock.invoke.mockResolvedValue(null)
    const api = createPxDevAPI()

    await api.workspace.discover({ rootPath: 'D:\\root', options: { maxDepth: 2 } })
    expect(ipcRendererMock.invoke).toHaveBeenLastCalledWith('workspace:discover', {
      rootPath: 'D:\\root',
      options: { maxDepth: 2 },
    })

    await api.workspace.applyDiscovery({ workspaceId: WORKSPACE_ID, services: [] })
    expect(ipcRendererMock.invoke).toHaveBeenLastCalledWith('workspace:applyDiscovery', {
      workspaceId: WORKSPACE_ID,
      services: [],
    })
  })

  it('⑲ system.detectProject 把裸字符串包装成 { path }', async () => {
    ipcRendererMock.invoke.mockResolvedValue(null)
    const api = createPxDevAPI()

    await api.system.detectProject('D:\\root\\web')
    expect(ipcRendererMock.invoke).toHaveBeenLastCalledWith('system:detectProject', {
      path: 'D:\\root\\web',
    })
  })
})

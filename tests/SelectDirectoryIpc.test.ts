// PX Dev — 目录选择 IPC 链路回归测试
// 覆盖需求：「创建工作区」弹窗「根目录」字段新增「浏览」按钮
// 该按钮复用既有通道 system:selectDirectory，本文件锁定其契约：
//   渲染层 api.system.selectDirectory() → preload → 主进程 handler → dialog
// 关注点：返回值语义（string | null）、取消行为、模态窗口绑定与降级。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/constants/ipc-channels'
import type { ScannerRegistry } from '@main/scanners'

// ============ Electron 模块 Mock ============
// vi.mock 会被提升到文件顶部，因此共享状态必须通过 vi.hoisted 创建
const { handlers, dialogMock, browserWindowMock, ipcRendererMock } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dialogMock: { showOpenDialog: vi.fn() },
  browserWindowMock: { fromWebContents: vi.fn() },
  ipcRendererMock: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  ipcRenderer: ipcRendererMock,
  dialog: dialogMock,
  BrowserWindow: browserWindowMock,
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

// mock 生效后再导入被测模块
const { registerSystemHandlers } = await import('@main/ipc/system.ipc')
const { createPxDevAPI } = await import('../src/preload/api')

/** 伪造的 ScannerRegistry，本文件不涉及扫描逻辑 */
const fakeScannerRegistry = { scan: vi.fn() } as unknown as ScannerRegistry

/** 伪造的 IpcMainInvokeEvent，仅需 sender 字段 */
const fakeEvent = { sender: { id: 1 } }

/** 伪造的 BrowserWindow：真实窗口一定带 isDestroyed()，测试替身需保持同构 */
function fakeWindow(id: string, destroyed = false): { id: string; isDestroyed: () => boolean } {
  return { id, isDestroyed: () => destroyed }
}

/** 取出 system:selectDirectory 的主进程 handler */
function getSelectDirectoryHandler(): (...args: unknown[]) => Promise<string | null> {
  const handler = handlers.get(IPC_CHANNELS.SYSTEM_SELECT_DIRECTORY)
  if (!handler) throw new Error('system:selectDirectory handler 未注册')
  return handler as (...args: unknown[]) => Promise<string | null>
}

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  registerSystemHandlers(fakeScannerRegistry)
})

describe('主进程 system:selectDirectory handler', () => {
  it('① handler 已注册到正确的通道名', () => {
    expect(IPC_CHANNELS.SYSTEM_SELECT_DIRECTORY).toBe('system:selectDirectory')
    expect(handlers.has('system:selectDirectory')).toBe(true)
  })

  it('② 用户选中目录 → 返回首个路径字符串', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(fakeWindow('win'))
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:\\Coding\\project\\demo'],
    })

    const result = await getSelectDirectoryHandler()(fakeEvent)

    expect(result).toBe('D:\\Coding\\project\\demo')
    expect(typeof result).toBe('string')
  })

  it('③ 用户取消对话框 → 返回 null（渲染层据此保持原值）', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(fakeWindow('win'))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await expect(getSelectDirectoryHandler()(fakeEvent)).resolves.toBeNull()
  })

  it('④ canceled=false 但 filePaths 为空 → 同样返回 null（防御性分支）', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(fakeWindow('win'))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })

    await expect(getSelectDirectoryHandler()(fakeEvent)).resolves.toBeNull()
  })

  it('⑤ 能拿到父窗口时以模态方式绑定主窗口', async () => {
    const parentWindow = fakeWindow('main-window')
    browserWindowMock.fromWebContents.mockReturnValue(parentWindow)
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\tmp'] })

    await getSelectDirectoryHandler()(fakeEvent)

    expect(browserWindowMock.fromWebContents).toHaveBeenCalledWith(fakeEvent.sender)
    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    const [firstArg] = dialogMock.showOpenDialog.mock.calls[0]
    expect(firstArg).toBe(parentWindow)
  })

  it('⑥ 拿不到父窗口时降级为无父窗口调用，且不抛错', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(null)
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\tmp'] })

    const result = await getSelectDirectoryHandler()(fakeEvent)

    expect(result).toBe('C:\\tmp')
    // 降级路径只传 options 一个参数
    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(dialogMock.showOpenDialog.mock.calls[0]).toHaveLength(1)
    const [options] = dialogMock.showOpenDialog.mock.calls[0]
    expect(options).toMatchObject({ properties: ['openDirectory', 'createDirectory'] })
  })

  it('⑦ 对话框选项包含标题与目录选择/新建目录能力', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(fakeWindow('win'))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await getSelectDirectoryHandler()(fakeEvent)

    const options = dialogMock.showOpenDialog.mock.calls[0][1]
    expect(options.title).toBe('选择文件夹')
    expect(options.properties).toContain('openDirectory')
    expect(options.properties).toContain('createDirectory')
    // 不应允许选择文件，避免把文件路径当作根目录
    expect(options.properties).not.toContain('openFile')
    expect(options.properties).not.toContain('multiSelections')
  })

  it('⑧ dialog 抛错时向渲染层透传异常，且保留可读原因', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(fakeWindow('win'))
    dialogMock.showOpenDialog.mockRejectedValue(new Error('dialog boom'))

    // 原始原因必须保留，渲染层才能提示出「为什么失败」
    await expect(getSelectDirectoryHandler()(fakeEvent)).rejects.toThrow('dialog boom')
    await expect(getSelectDirectoryHandler()(fakeEvent)).rejects.toThrow('打开目录选择对话框失败')
  })

  it('⑨ 父窗口已销毁时降级为无父窗口调用，不抛错', async () => {
    browserWindowMock.fromWebContents.mockReturnValue(fakeWindow('dead', true))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\tmp'] })

    const result = await getSelectDirectoryHandler()(fakeEvent)

    expect(result).toBe('C:\\tmp')
    expect(dialogMock.showOpenDialog.mock.calls[0]).toHaveLength(1)
  })

  it('⑩ fromWebContents 抛异常时降级为无父窗口调用，不让整个 handler 失败', async () => {
    // 用 Once 避免实现泄漏到后续用例（clearAllMocks 不会重置 implementation）
    browserWindowMock.fromWebContents.mockImplementationOnce(() => {
      throw new Error('webContents already destroyed')
    })
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\tmp'] })

    const result = await getSelectDirectoryHandler()(fakeEvent)

    expect(result).toBe('C:\\tmp')
    expect(dialogMock.showOpenDialog.mock.calls[0]).toHaveLength(1)
  })
})

describe('preload 层 system.selectDirectory 契约', () => {
  it('⑪ 调用 invoke 时使用正确通道且不携带入参（无序列化风险）', async () => {
    ipcRendererMock.invoke.mockResolvedValue('D:\\picked')

    const api = createPxDevAPI()
    const result = await api.system.selectDirectory()

    expect(ipcRendererMock.invoke).toHaveBeenCalledTimes(1)
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('system:selectDirectory')
    // 只有通道名一个参数 → 不存在 Vue 响应式代理跨 IPC 克隆问题
    expect(ipcRendererMock.invoke.mock.calls[0]).toHaveLength(1)
    expect(result).toBe('D:\\picked')
  })

  it('⑫ 取消时 preload 原样透传 null', async () => {
    ipcRendererMock.invoke.mockResolvedValue(null)

    const api = createPxDevAPI()
    await expect(api.system.selectDirectory()).resolves.toBeNull()
  })
})

describe('渲染层「浏览」按钮回填逻辑契约', () => {
  // WorkspaceCreateModal.handleSelectRootPath 的核心行为在无 DOM 环境下
  // 无法直接挂载组件验证，这里锁定其依赖的纯逻辑：从路径推导目录名。
  // 与组件内实现保持一致：path.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  function deriveFolderName(path: string): string {
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  }

  it.each([
    ['D:\\Coding\\project\\PX Dev', 'PX Dev'],
    ['D:\\Coding\\project\\demo\\', 'demo'],
    ['/home/user/workspace/api-server', 'api-server'],
    ['C:\\', 'C:'],
    ['D:/mixed\\sep/folder', 'folder'],
  ])('⑬ 从路径 %s 推导目录名 → %s', (input, expected) => {
    expect(deriveFolderName(input)).toBe(expected)
  })
})

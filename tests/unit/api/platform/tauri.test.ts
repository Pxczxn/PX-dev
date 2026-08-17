import { describe, it, expect, vi } from 'vitest'
import { createTauriAdapter } from '@renderer/api/platform/tauri'
import { NotImplementedError } from '@renderer/api/platform/types'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('Tauri Adapter', () => {
  it('creates adapter with complete PxDevClient interface', () => {
    const adapter = createTauriAdapter()

    // 验证所有命名空间存在
    expect(adapter.workspace).toBeDefined()
    expect(adapter.service).toBeDefined()
    expect(adapter.process).toBeDefined()
    expect(adapter.log).toBeDefined()
    expect(adapter.environment).toBeDefined()
    expect(adapter.port).toBeDefined()
    expect(adapter.system).toBeDefined()
    expect(adapter.app).toBeDefined()
    expect(adapter.events).toBeDefined()
  })

  it('implements system.ping', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue('PX Dev Tauri backend ready')

    const adapter = createTauriAdapter()
    const response = await adapter.system.ping()

    expect(invoke).toHaveBeenCalledWith('px_ping')
    expect(response).toBe('PX Dev Tauri backend ready')
  })

  it('throws NotImplementedError for unimplemented workspace methods', () => {
    const adapter = createTauriAdapter()

    // Phase 3: list, create, update, delete are now implemented
    // Only test unimplemented methods
    expect(() => adapter.workspace.discover({ rootPath: '/test' })).toThrow(NotImplementedError)
    expect(() => adapter.workspace.discover({ rootPath: '/test' })).toThrow('workspace.discover is not implemented')
  })

  it('calls list_services with workspaceId parameter', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue([])

    const adapter = createTauriAdapter()

    // Test with workspaceId
    await adapter.service.list('ws-123')
    expect(invoke).toHaveBeenCalledWith('list_services', { workspaceId: 'ws-123' })

    // Test without workspaceId
    await adapter.service.list()
    expect(invoke).toHaveBeenCalledWith('list_services', { workspaceId: undefined })
  })

  it('calls workspace CRUD commands correctly', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue({})

    const adapter = createTauriAdapter()

    await adapter.workspace.list()
    expect(invoke).toHaveBeenCalledWith('list_workspaces')

    await adapter.workspace.create({ name: 'Test' })
    expect(invoke).toHaveBeenCalledWith('create_workspace', { input: { name: 'Test' } })

    await adapter.workspace.update({ id: 'ws-1', name: 'Updated' })
    expect(invoke).toHaveBeenCalledWith('update_workspace', { input: { id: 'ws-1', name: 'Updated' } })

    await adapter.workspace.delete('ws-1')
    expect(invoke).toHaveBeenCalledWith('delete_workspace', { id: 'ws-1' })
  })

  it('calls service CRUD commands correctly', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue({})

    const adapter = createTauriAdapter()

    await adapter.service.create({ workspaceId: 'ws-1', name: 'Test' })
    expect(invoke).toHaveBeenCalledWith('create_service', { input: { workspaceId: 'ws-1', name: 'Test' } })

    await adapter.service.update({ id: 'svc-1', name: 'Updated' })
    expect(invoke).toHaveBeenCalledWith('update_service', { input: { id: 'svc-1', name: 'Updated' } })

    await adapter.service.delete('svc-1')
    expect(invoke).toHaveBeenCalledWith('delete_service', { id: 'svc-1' })
  })

  it('throws NotImplementedError for process methods', () => {
    const adapter = createTauriAdapter()

    expect(() => adapter.process.start('service-id')).toThrow(NotImplementedError)
    expect(() => adapter.process.start('service-id')).toThrow('process.start is not implemented')
  })

  it('throws NotImplementedError for log methods', () => {
    const adapter = createTauriAdapter()

    expect(() => adapter.log.subscribe('service-id')).toThrow(NotImplementedError)
    expect(() => adapter.log.subscribe('service-id')).toThrow('log.subscribe is not implemented')
  })

  it('throws NotImplementedError for environment methods', () => {
    const adapter = createTauriAdapter()

    expect(() => adapter.environment.detect()).toThrow(NotImplementedError)
    expect(() => adapter.environment.detect()).toThrow('environment.detect is not implemented')
  })

  it('throws NotImplementedError for port methods', () => {
    const adapter = createTauriAdapter()

    expect(() => adapter.port.check(3000)).toThrow(NotImplementedError)
    expect(() => adapter.port.check(3000)).toThrow('port.check is not implemented')
  })

  it('throws NotImplementedError for unimplemented system methods', () => {
    const adapter = createTauriAdapter()

    expect(() => adapter.system.openPath('/path')).toThrow(NotImplementedError)
    expect(() => adapter.system.openPath('/path')).toThrow('system.openPath is not implemented')
    
    expect(() => adapter.system.selectDirectory()).toThrow(NotImplementedError)
    expect(() => adapter.system.selectDirectory()).toThrow('system.selectDirectory is not implemented')
  })

  it('throws NotImplementedError for unimplemented app methods', () => {
    const adapter = createTauriAdapter()

    // Phase 2: getSettings, updateSettings, getVersion are now implemented
    // Only test unimplemented methods
    expect(() => adapter.app.quit()).toThrow(NotImplementedError)
    expect(() => adapter.app.quit()).toThrow('app.quit is not implemented')
  })

  it('throws NotImplementedError for event methods', () => {
    const adapter = createTauriAdapter()

    expect(() => adapter.events.onLogBatch(() => {})).toThrow(NotImplementedError)
    expect(() => adapter.events.onLogBatch(() => {})).toThrow('events.onLogBatch is not implemented')
  })

  it('NotImplementedError includes method name and phase', () => {
    const adapter = createTauriAdapter()

    try {
      adapter.workspace.delete('workspace-id')
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError)
      expect((error as NotImplementedError).name).toBe('NotImplementedError')
      expect((error as NotImplementedError).message).toContain('workspace.delete')
      expect((error as NotImplementedError).message).toContain('Phase 1')
    }
  })
})

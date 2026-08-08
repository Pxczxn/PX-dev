// PX Dev — Workspace Store
// Manages workspace + service list (mirror of Main process config)

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Workspace, Service } from '@shared/types'
import { api } from '@renderer/api'

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<Workspace[]>([])
  const services = ref<Service[]>([])
  const loading = ref(false)

  // Computed: services grouped by workspaceId
  const servicesByWorkspace = computed(() => {
    const map = new Map<string, Service[]>()
    for (const svc of services.value) {
      const list = map.get(svc.workspaceId) ?? []
      list.push(svc)
      map.set(svc.workspaceId, list)
    }
    return map
  })

  // Computed: favorite workspaces
  const favoriteWorkspaces = computed(() =>
    workspaces.value.filter((w) => w.favorite),
  )

  async function fetchWorkspaces(): Promise<void> {
    loading.value = true
    try {
      workspaces.value = await api.workspace.list()
    } catch (err) {
      console.error('Failed to fetch workspaces:', err)
    } finally {
      loading.value = false
    }
  }

  async function fetchServices(workspaceId?: string): Promise<void> {
    try {
      services.value = await api.service.list(workspaceId)
    } catch (err) {
      console.error('Failed to fetch services:', err)
    }
  }

  async function createWorkspace(input: Record<string, unknown>): Promise<Workspace> {
    const ws = await api.workspace.create(input)
    workspaces.value.push(ws)
    return ws
  }

  async function updateWorkspace(input: Record<string, unknown>): Promise<Workspace> {
    const updated = await api.workspace.update(input)
    const idx = workspaces.value.findIndex((w) => w.id === updated.id)
    if (idx !== -1) {
      workspaces.value[idx] = updated
    }
    return updated
  }

  async function deleteWorkspace(id: string): Promise<void> {
    await api.workspace.delete(id)
    workspaces.value = workspaces.value.filter((w) => w.id !== id)
    services.value = services.value.filter((s) => s.workspaceId !== id)
  }

  async function createService(input: Record<string, unknown>): Promise<Service> {
    const svc = await api.service.create(input)
    services.value.push(svc)
    return svc
  }

  async function updateService(input: Record<string, unknown>): Promise<Service> {
    const updated = await api.service.update(input)
    const idx = services.value.findIndex((s) => s.id === updated.id)
    if (idx !== -1) {
      services.value[idx] = updated
    }
    return updated
  }

  async function deleteService(id: string): Promise<void> {
    await api.service.delete(id)
    services.value = services.value.filter((s) => s.id !== id)
  }

  function getWorkspace(id: string): Workspace | undefined {
    return workspaces.value.find((w) => w.id === id)
  }

  function getService(id: string): Service | undefined {
    return services.value.find((s) => s.id === id)
  }

  function getServicesByWorkspace(workspaceId: string): Service[] {
    return services.value.filter((s) => s.workspaceId === workspaceId)
  }

  return {
    workspaces,
    services,
    loading,
    servicesByWorkspace,
    favoriteWorkspaces,
    fetchWorkspaces,
    fetchServices,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    createService,
    updateService,
    deleteService,
    getWorkspace,
    getService,
    getServicesByWorkspace,
  }
})

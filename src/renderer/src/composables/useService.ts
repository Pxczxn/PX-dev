// PX Dev — useService Composable
// Encapsulates service start/stop/restart operations with message feedback

import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { api } from '@renderer/api'
import { useRuntimeStore } from '@renderer/stores/runtimeStore'
import type { Service } from '@shared/types'

export function useService() {
  const message = useMessage()
  const runtimeStore = useRuntimeStore()
  const operating = ref<Set<string>>(new Set())

  /** Check if a service is currently being operated on */
  function isOperating(serviceId: string): boolean {
    return operating.value.has(serviceId)
  }

  /** Start a service */
  async function startService(service: Service): Promise<void> {
    if (isOperating(service.id)) return
    operating.value.add(service.id)

    try {
      const runtime = await api.process.start(service.id)
      runtimeStore.updateRuntime(service.id, runtime)
      message.success(`服务 ${service.name} 已启动`)
    } catch (err) {
      const error = err as { code?: string; message?: string }
      const code = error?.code ?? ''
      if (code === 'PORT_CONFLICT') {
        message.error(`端口冲突: ${error.message}`)
      } else if (code === 'CWD_NOT_FOUND') {
        message.error(`工作目录不存在: ${error.message}`)
      } else if (code === 'PROCESS_RUNNING') {
        message.warning(`服务 ${service.name} 已在运行中`)
      } else {
        message.error(`启动失败: ${error?.message ?? '未知错误'}`)
      }
    } finally {
      operating.value.delete(service.id)
    }
  }

  /** Stop a service */
  async function stopService(service: Service): Promise<void> {
    if (isOperating(service.id)) return
    operating.value.add(service.id)

    try {
      const runtime = await api.process.stop(service.id)
      runtimeStore.updateRuntime(service.id, runtime)
      message.success(`服务 ${service.name} 已停止`)
    } catch (err) {
      const error = err as { message?: string }
      message.error(`停止失败: ${error?.message ?? '未知错误'}`)
    } finally {
      operating.value.delete(service.id)
    }
  }

  /** Restart a service */
  async function restartService(service: Service): Promise<void> {
    if (isOperating(service.id)) return
    operating.value.add(service.id)

    try {
      const runtime = await api.process.restart(service.id)
      runtimeStore.updateRuntime(service.id, runtime)
      message.success(`服务 ${service.name} 已重启`)
    } catch (err) {
      const error = err as { message?: string }
      message.error(`重启失败: ${error?.message ?? '未知错误'}`)
    } finally {
      operating.value.delete(service.id)
    }
  }

  /** Force kill a service */
  async function forceKillService(service: Service): Promise<void> {
    if (isOperating(service.id)) return
    operating.value.add(service.id)

    try {
      await api.process.forceKill(service.id)
      message.success(`服务 ${service.name} 已强制终止`)
    } catch (err) {
      const error = err as { message?: string }
      message.error(`强制终止失败: ${error?.message ?? '未知错误'}`)
    } finally {
      operating.value.delete(service.id)
    }
  }

  return {
    operating,
    isOperating,
    startService,
    stopService,
    restartService,
    forceKillService,
  }
}

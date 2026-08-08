// PX Dev — useLogStream Composable
// Manages log subscription lifecycle for a component

import { onMounted, onUnmounted, watch } from 'vue'
import { useLogStore } from '@renderer/stores/logStore'
import type { Ref } from 'vue'

/**
 * Subscribe to a service's log stream.
 * Auto-subscribes on mount, unsubscribes on unmount.
 *
 * @param serviceId - Ref to the service ID to subscribe to
 */
export function useLogStream(serviceId: Ref<string | null>) {
  const logStore = useLogStore()

  // Start global event listener if not already started
  onMounted(() => {
    logStore.startListening()
  })

  // Watch for serviceId changes
  watch(
    serviceId,
    async (newId, oldId) => {
      if (oldId) {
        await logStore.unsubscribe(oldId)
      }
      if (newId) {
        logStore.setActiveService(newId)
        await logStore.loadHistory(newId)
        await logStore.subscribe(newId)
      } else {
        logStore.setActiveService(null)
      }
    },
    { immediate: true },
  )

  // Unsubscribe on unmount
  onUnmounted(async () => {
    if (serviceId.value) {
      await logStore.unsubscribe(serviceId.value)
    }
  })

  return {
    logStore,
  }
}

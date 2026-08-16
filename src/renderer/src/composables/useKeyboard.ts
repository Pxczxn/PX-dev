// PX Dev — Keyboard Shortcuts Composable
// Global keyboard shortcuts management with context awareness

import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export type KeyboardShortcut = {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  description: string
  action: () => void | Promise<void>
  context?: string // e.g., 'workspace-detail', 'logs', 'global'
}

// Normalize key based on OS
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const modKey = isMac ? 'meta' : 'ctrl'

export function useKeyboard() {
  const router = useRouter()
  const route = useRoute()
  const shortcuts = ref<KeyboardShortcut[]>([])
  const isEnabled = ref(true)

  // Check if we're in an input/textarea
  function isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    const tagName = target.tagName.toLowerCase()
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      target.isContentEditable
    )
  }

  // Match shortcut against event
  function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
    const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey
    const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
    const altMatch = shortcut.alt ? event.altKey : !event.altKey
    const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey

    return keyMatch && ctrlMatch && shiftMatch && altMatch && metaMatch
  }

  // Check if shortcut is valid in current context
  function isValidContext(shortcut: KeyboardShortcut): boolean {
    if (!shortcut.context || shortcut.context === 'global') return true
    return route.name?.toString().includes(shortcut.context) ?? false
  }

  // Handle keyboard event
  async function handleKeydown(event: KeyboardEvent): Promise<void> {
    if (!isEnabled.value) return

    // Skip if typing in input fields (unless it's a global command like Cmd+K)
    const isGlobalCommand = (event.ctrlKey || event.metaKey) && ['k', 'p', ','].includes(event.key.toLowerCase())
    if (isInputElement(event.target) && !isGlobalCommand) {
      return
    }

    for (const shortcut of shortcuts.value) {
      if (matchesShortcut(event, shortcut) && isValidContext(shortcut)) {
        event.preventDefault()
        event.stopPropagation()
        await shortcut.action()
        break
      }
    }
  }

  // Register a shortcut
  function register(shortcut: KeyboardShortcut): void {
    shortcuts.value.push(shortcut)
  }

  // Unregister a shortcut
  function unregister(key: string, context?: string): void {
    shortcuts.value = shortcuts.value.filter(
      (s) => !(s.key === key && (!context || s.context === context))
    )
  }

  // Get shortcut display string
  function getShortcutDisplay(shortcut: KeyboardShortcut): string {
    const parts: string[] = []
    if (shortcut.ctrl || shortcut.meta) parts.push(isMac ? '⌘' : 'Ctrl')
    if (shortcut.shift) parts.push(isMac ? '⇧' : 'Shift')
    if (shortcut.alt) parts.push(isMac ? '⌥' : 'Alt')
    parts.push(shortcut.key.toUpperCase())
    return parts.join(isMac ? '' : '+')
  }

  // Enable/disable shortcuts
  function enable(): void {
    isEnabled.value = true
  }

  function disable(): void {
    isEnabled.value = false
  }

  // Get shortcuts for current context
  const contextShortcuts = computed(() => {
    return shortcuts.value.filter((s) => isValidContext(s))
  })

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    register,
    unregister,
    enable,
    disable,
    getShortcutDisplay,
    shortcuts: contextShortcuts,
    isEnabled,
  }
}

// Global shortcuts registry
export function useGlobalShortcuts() {
  const keyboard = useKeyboard()
  const router = useRouter()

  // Navigation shortcuts (Ctrl/Cmd + 1-7)
  function registerNavigationShortcuts(): void {
    const routes = [
      { key: '1', path: '/', description: '跳转到仪表盘' },
      { key: '2', path: '/workspaces', description: '跳转到工作区' },
      { key: '3', path: '/services', description: '跳转到服务' },
      { key: '4', path: '/ports', description: '跳转到端口' },
      { key: '5', path: '/logs', description: '跳转到日志' },
      { key: '6', path: '/environment', description: '跳转到环境' },
      { key: '7', path: '/settings', description: '跳转到设置' },
    ]

    routes.forEach((route) => {
      keyboard.register({
        key: route.key,
        [modKey]: true,
        description: route.description,
        action: async () => {
          await router.push(route.path)
        },
        context: 'global',
      })
    })
  }

  // Browser-like navigation
  function registerBrowserShortcuts(): void {
    keyboard.register({
      key: '[',
      [modKey]: true,
      description: '后退',
      action: () => {
        router.back()
      },
      context: 'global',
    })

    keyboard.register({
      key: ']',
      [modKey]: true,
      description: '前进',
      action: () => {
        router.forward()
      },
      context: 'global',
    })
  }

  // Settings shortcut
  function registerSettingsShortcut(): void {
    keyboard.register({
      key: ',',
      [modKey]: true,
      description: '打开设置',
      action: async () => {
        await router.push('/settings')
      },
      context: 'global',
    })
  }

  return {
    registerNavigationShortcuts,
    registerBrowserShortcuts,
    registerSettingsShortcut,
    keyboard,
  }
}

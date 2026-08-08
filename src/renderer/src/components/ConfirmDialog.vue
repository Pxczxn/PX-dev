<script setup lang="ts">
// PX Dev — ConfirmDialog Component
// Reusable confirmation dialog with NDialog

import { useDialog } from 'naive-ui'

export interface ConfirmOptions {
  title: string
  content: string
  positiveText?: string
  negativeText?: string
  type?: 'info' | 'success' | 'warning' | 'error'
}

const dialog = useDialog()

/**
 * Show a confirmation dialog.
 * Returns a promise that resolves to true (confirm) or false (cancel).
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dialog[options.type ?? 'warning']({
      title: options.title,
      content: options.content,
      positiveText: options.positiveText ?? '确认',
      negativeText: options.negativeText ?? '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onMaskClick: () => resolve(false),
    })
  })
}
</script>

<script setup lang="ts">
// PX Dev — EmptyState Component
// Calm, educational empty state: icon chip + title + hint + optional action.

import { NButton } from 'naive-ui'

defineProps<{
  title: string
  description?: string
  actionText?: string
  icon?: string
}>()

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-art">
      <span class="empty-icon">{{ icon ?? '📋' }}</span>
    </div>
    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <NButton
      v-if="actionText"
      type="primary"
      size="medium"
      class="empty-action"
      @click="emit('action')"
    >
      {{ actionText }}
    </NButton>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-height: 280px;
  padding: 32px;
  gap: 4px;
}

.empty-art {
  width: 64px;
  height: 64px;
  border-radius: var(--r-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  margin-bottom: 16px;
}

.empty-icon {
  font-size: 30px;
  opacity: 0.9;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0;
}

.empty-desc {
  font-size: 13px;
  color: var(--text-3);
  max-width: 320px;
  margin-top: 6px;
  line-height: 1.5;
}

.empty-action {
  margin-top: 18px;
}
</style>

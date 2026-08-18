<script setup lang="ts">
// PX Dev — EmptyState 组件
// 空状态占位：图标 + 标题 + 描述 + 可选操作按钮

import { NButton, NIcon } from 'naive-ui'
import { FolderOpenOutline } from '@vicons/ionicons5'
import type { Component } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  actionText?: string
  icon?: Component   // 图标组件（可选，默认使用文件夹图标）
}>(), {
  icon: FolderOpenOutline,
})

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon-wrapper">
      <NIcon :component="icon" :size="32" class="empty-icon" />
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
  min-height: 260px;
  padding: 40px 32px;
  gap: 6px;
}

.empty-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: var(--r-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  margin-bottom: 16px;
  transition:
    border-color var(--dur-2) var(--ease-out),
    background var(--dur-2) var(--ease-out);
}

.empty-state:hover .empty-icon-wrapper {
  border-color: var(--border-default);
  background: var(--bg-surface-1);
}

.empty-icon {
  color: var(--text-3);
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
  max-width: 360px;
  margin: 6px 0 0;
  line-height: 1.6;
}

.empty-action {
  margin-top: 18px;
}
</style>

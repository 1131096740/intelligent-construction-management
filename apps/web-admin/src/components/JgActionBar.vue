<template>
  <div
    class="jg-action-bar"
    :aria-label="label"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: "可执行操作" });
</script>

<style scoped>
.jg-action-bar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--jg-space-sm); }
@media (max-width: 720px) { .jg-action-bar { justify-content: stretch; } .jg-action-bar :deep(.t-button) { flex: 1 1 auto; } }
</style>

<template>
  <t-card
    class="jg-filter-bar"
    :bordered="true"
  >
    <header class="jg-filter-bar__header">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="description">
          {{ description }}
        </p>
      </div>
      <div class="jg-filter-bar__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="jg-filter-bar__filters">
      <slot />
    </div>
  </t-card>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string }>(), { description: "" });
</script>

<style scoped>
.jg-filter-bar { min-width: 0; background: var(--jg-color-bg-panel); }
.jg-filter-bar__header { display: flex; justify-content: space-between; gap: var(--jg-space-md); }
.jg-filter-bar__header h2 { margin: 0; color: var(--jg-color-text-primary); font-size: var(--jg-font-size-section-title); }
.jg-filter-bar__header p { margin: var(--jg-space-xs) 0 0; color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.jg-filter-bar__actions, .jg-filter-bar__filters { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
.jg-filter-bar__filters { margin-top: var(--jg-space-md); gap: var(--jg-space-md); }
@media (max-width: 720px) { .jg-filter-bar__header { flex-direction: column; } }
</style>

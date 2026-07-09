<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <t-card
    class="business-table-toolbar"
    bordered
  >
    <div class="business-table-toolbar__header">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="description">
          {{ description }}
        </p>
      </div>
      <div class="business-table-toolbar__actions">
        <slot name="actions" />
      </div>
    </div>
    <div class="business-table-toolbar__filters">
      <slot />
    </div>
  </t-card>
</template>

<style scoped>
.business-table-toolbar {
  background: var(--jg-color-bg-panel);
}

.business-table-toolbar__header {
  display: flex;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.business-table-toolbar__header h2 {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.business-table-toolbar__header p {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.business-table-toolbar__actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
}

.business-table-toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-md);
}
</style>

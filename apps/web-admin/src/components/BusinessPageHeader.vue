<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <header class="business-page-header">
    <div class="business-page-header__layout">
      <div class="business-page-header__copy">
        <h1>{{ title }}</h1>
        <p v-if="description">
          {{ description }}
        </p>
      </div>
      <div class="business-page-header__actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.business-page-header {
  min-width: 0;
  container-name: jg-page-header;
  container-type: inline-size;
}

.business-page-header__layout {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-lg);
}

.business-page-header__copy {
  min-width: 0;
}

.business-page-header h1,
.business-page-header p {
  margin: 0;
}

.business-page-header h1 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-page-title);
  font-weight: var(--jg-font-weight-bold);
  line-height: var(--jg-line-height-title);
}

.business-page-header p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-body);
  line-height: var(--jg-line-height-body);
}

.business-page-header__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

@container jg-page-header (max-width: 720px) {
  .business-page-header__layout {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

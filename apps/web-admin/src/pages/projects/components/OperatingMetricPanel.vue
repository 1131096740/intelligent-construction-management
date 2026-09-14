<template>
  <t-card class="operating-metric-panel">
    <h2>{{ title }}</h2>
    <dl>
      <div
        v-for="item in items"
        :key="item.label"
      >
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
  </t-card>
</template>

<script setup lang="ts">
defineProps<{ title: string; items: readonly { label: string; value: string }[] }>();
</script>

<style scoped>
.operating-metric-panel {
  min-width: 0;
  background: var(--jg-color-bg-panel);
  border-radius: var(--jg-radius-overlay);
}
.operating-metric-panel :deep(.t-card__body) {
  padding: var(--jg-space-lg);
}
h2 {
  margin: 0;
  font-size: var(--jg-font-size-section-title);
}
dl {
  display: grid;
  gap: var(--jg-space-sm-plus);
  margin: var(--jg-space-md-plus) 0 0;
}
dl div {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  padding-bottom: var(--jg-space-sm-plus);
  border-bottom: 1px solid var(--jg-color-border);
}
dt { color: var(--jg-color-text-tertiary); }
dd { margin: 0; font-weight: var(--jg-font-weight-semibold); }
</style>

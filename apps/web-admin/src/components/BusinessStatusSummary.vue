<script setup lang="ts">
import { computed } from "vue";
import {
  normalizeBusinessStatusSummaryItems,
  type BusinessStatusSummaryItem
} from "./business-status-summary.config";

const props = defineProps<{
  items: BusinessStatusSummaryItem[];
}>();

const normalizedItems = computed(() => normalizeBusinessStatusSummaryItems(props.items));
</script>

<template>
  <t-card
    class="business-status-summary"
    bordered
  >
    <div
      v-for="(item, index) in normalizedItems"
      :key="`${item.label}:${index}`"
      class="business-status-summary__item"
    >
      <span class="business-status-summary__label">{{ item.label }}</span>
      <t-tag
        :theme="item.tone"
        variant="light"
      >
        {{ item.value }}
      </t-tag>
    </div>
  </t-card>
</template>

<style scoped>
.business-status-summary {
  background: var(--jg-color-bg-panel);
}

.business-status-summary :deep(.t-card__body) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-summary-item-min-width), 1fr));
  gap: var(--jg-space-md);
  padding: var(--jg-space-md);
}

.business-status-summary__item {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-xs);
}

.business-status-summary__label {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}
</style>

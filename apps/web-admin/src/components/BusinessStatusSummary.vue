<script setup lang="ts">
import { computed } from "vue";
import {
  normalizeBusinessStatusSummaryItems,
  type BusinessStatusSummaryItem
} from "./business-status-summary.config";

const props = withDefaults(defineProps<{
  items: BusinessStatusSummaryItem[];
  appearance?: "status" | "metrics";
}>(), {
  appearance: "status"
});

const normalizedItems = computed(() => normalizeBusinessStatusSummaryItems(props.items));
</script>

<template>
  <t-card
    :class="['business-status-summary', `business-status-summary--${appearance}`]"
    bordered
  >
    <div
      v-for="(item, index) in normalizedItems"
      :key="`${item.label}:${index}`"
      class="business-status-summary__item"
    >
      <span class="business-status-summary__label">{{ item.label }}</span>
      <span
        v-if="appearance === 'metrics'"
        :class="['business-status-summary__value', `business-status-summary__value--${item.tone ?? 'default'}`]"
      >
        {{ item.value }}
      </span>
      <t-tag
        v-else
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
  min-width: 0;
  background: var(--jg-color-bg-panel);
  container-name: jg-status-summary;
  container-type: inline-size;
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

.business-status-summary--metrics :deep(.t-card__body) {
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-summary-metric-min-width), 1fr));
  gap: 0;
  padding: 0;
}

.business-status-summary--metrics .business-status-summary__item {
  justify-content: center;
  min-height: 72px;
  padding: var(--jg-space-md) var(--jg-space-lg);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
}

.business-status-summary--metrics .business-status-summary__item:last-child {
  border-right: 0;
}

.business-status-summary--metrics .business-status-summary__label {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-summary-label);
}

.business-status-summary__value {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-summary-value);
  font-weight: var(--jg-font-weight-semibold);
  line-height: var(--jg-line-height-tight);
}

.business-status-summary__value--primary {
  color: var(--jg-color-brand);
}

.business-status-summary__value--success {
  color: var(--jg-color-success);
}

.business-status-summary__value--warning {
  color: var(--jg-color-warning);
}

.business-status-summary__value--danger {
  color: var(--jg-color-danger);
}

@container jg-status-summary (max-width: 680px) {
  .business-status-summary--metrics :deep(.t-card__body) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .business-status-summary--metrics .business-status-summary__item {
    border-right: 0;
    border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  }

  .business-status-summary--metrics .business-status-summary__item:last-child {
    border-bottom: 0;
  }
}

@container jg-status-summary (max-width: 420px) {
  .business-status-summary--metrics :deep(.t-card__body) {
    grid-template-columns: 1fr;
  }
}
</style>

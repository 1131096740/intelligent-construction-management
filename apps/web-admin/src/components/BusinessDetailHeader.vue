<script setup lang="ts">
import { computed } from "vue";
import type { BusinessSummaryTone } from "./business-status-summary.config";

const props = withDefaults(defineProps<{
  businessCode: string;
  title: string;
  status: string;
  statusTone?: BusinessSummaryTone;
  owner: string;
  currentNode: string;
  nextStep: string;
  requestedAmount?: string;
  amountLabel?: string;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
}>(), {
  statusTone: "default",
  requestedAmount: "",
  amountLabel: "申请金额",
  primaryActionLabel: "",
  primaryActionDisabled: false
});

const emit = defineEmits<{
  "primary-action": [];
}>();

const visibleFacts = computed(() => [
  { label: props.amountLabel, value: props.requestedAmount },
  { label: "责任人/部门", value: props.owner },
  { label: "当前节点", value: props.currentNode },
  { label: "下一步", value: props.nextStep }
].filter((item, index, facts) =>
  item.value &&
  item.value !== "-" &&
  item.value !== props.status &&
  facts.findIndex((candidate) => candidate.value === item.value) === index
));
</script>

<template>
  <header class="business-detail-header">
    <div class="business-detail-header__layout">
      <div class="business-detail-header__main">
        <span class="business-detail-header__code">{{ businessCode }}</span>
        <div class="business-detail-header__title-row">
          <div>
            <h1>{{ title }}</h1>
          </div>
          <t-tag
            :theme="statusTone ?? 'default'"
            variant="light"
          >
            {{ status }}
          </t-tag>
        </div>
        <dl class="business-detail-header__facts">
          <div
            v-for="fact in visibleFacts"
            :key="fact.label"
          >
            <dt>{{ fact.label }}</dt>
            <dd>{{ fact.value }}</dd>
          </div>
        </dl>
      </div>
      <div class="business-detail-header__actions">
        <t-button
          v-if="primaryActionLabel"
          theme="primary"
          :disabled="primaryActionDisabled"
          @click="emit('primary-action')"
        >
          {{ primaryActionLabel }}
        </t-button>
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.business-detail-header {
  min-width: 0;
  padding-bottom: var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  container-name: jg-detail-header;
  container-type: inline-size;
}

.business-detail-header__layout {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-xl);
}

.business-detail-header__main {
  min-width: 0;
  flex: 1;
}

.business-detail-header__title-row {
  display: flex;
  align-items: flex-start;
  gap: var(--jg-space-md);
}

.business-detail-header__title-row > div {
  min-width: 0;
  flex: 0 1 auto;
}

.business-detail-header__code {
  display: block;
  margin-bottom: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.business-detail-header h1 {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-page-title);
  line-height: var(--jg-line-height-title);
}

.business-detail-header__title-row :deep(.t-tag) {
  width: max-content;
  flex: 0 0 auto;
  align-self: center;
}

.business-detail-header__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xl);
  margin: var(--jg-space-md) 0 0;
}

.business-detail-header__facts div {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 132px;
}

.business-detail-header dt {
  color: var(--jg-color-text-muted);
  font-size: var(--jg-font-size-meta);
}

.business-detail-header dd {
  margin: 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
}

.business-detail-header__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

@container jg-detail-header (max-width: 760px) {
  .business-detail-header__layout {
    flex-direction: column;
  }
}
</style>

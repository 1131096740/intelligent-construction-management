<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryFrozenSnapshot } from "@jiangkong/shared-domain";
import { formatBusinessEntryReadonlyValue } from "../lib/business-entry-adapters";

const props = defineProps<{ submittedRecord: BusinessEntryFrozenSnapshot }>();
const groups = computed(() => {
  const result = new Map<string, typeof props.submittedRecord.definition.fields>();
  for (const field of props.submittedRecord.definition.fields) {
    const group = field.group || "业务信息";
    result.set(group, [...(result.get(group) ?? []), field]);
  }
  return [...result.entries()];
});
</script>

<template>
  <section
    class="business-entry-readonly"
    :aria-label="`${submittedRecord.definition.name}提交快照`"
  >
    <t-alert
      theme="info"
      title="以下内容来自提交时冻结的业务快照"
      :close="false"
    />
    <t-card
      v-for="([group, fields]) in groups"
      :key="group"
      :title="group"
      class="business-entry-readonly__group"
    >
      <dl class="business-entry-readonly__fields">
        <div
          v-for="field in fields"
          :key="field.key"
        >
          <dt>{{ field.label }}</dt>
          <dd>{{ formatBusinessEntryReadonlyValue(field, submittedRecord.values[field.key]) }}</dd>
        </div>
      </dl>
    </t-card>
  </section>
</template>

<style scoped>
.business-entry-readonly,
.business-entry-readonly__fields {
  display: grid;
  gap: var(--jg-space-md);
}

.business-entry-readonly__fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.business-entry-readonly__fields div {
  display: grid;
  gap: var(--jg-space-xs);
}

.business-entry-readonly__fields dt {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.business-entry-readonly__fields dd {
  margin: 0;
  color: var(--jg-color-text-primary);
}

@media (max-width: 767px) {
  .business-entry-readonly__fields { grid-template-columns: minmax(0, 1fr); }
}
</style>

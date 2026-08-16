<script setup lang="ts">
import type { BusinessEntryImportMode } from "../lib/business-entry-adapters";

defineProps<{ modelValue?: BusinessEntryImportMode; currentRowCount: number }>();
const emit = defineEmits<{ "update:modelValue": [value: BusinessEntryImportMode] }>();

function updateChoice(value: unknown) {
  if (value === "new" || value === "append") emit("update:modelValue", value);
}
</script>

<template>
  <t-card
    title="选择 Excel 草稿处理方式"
    class="business-entry-import-choice"
  >
    <t-alert
      theme="warning"
      title="上传或粘贴不会静默覆盖当前草稿"
      :close="false"
    />
    <t-radio-group
      :value="modelValue"
      @change="updateChoice"
    >
      <t-radio value="new">
        新建草稿
      </t-radio>
      <t-radio
        value="append"
        :disabled="currentRowCount === 0"
      >
        追加到当前草稿
      </t-radio>
    </t-radio-group>
  </t-card>
</template>

<style scoped>
.business-entry-import-choice {
  display: grid;
  gap: var(--jg-space-md);
}
</style>

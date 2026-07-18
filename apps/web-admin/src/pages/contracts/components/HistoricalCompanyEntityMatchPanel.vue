<template>
  <div class="historical-company-match">
    <label>
      <span>原合同载明的我方主体</span>
      <t-input
        :value="originalName"
        :disabled="disabled"
        placeholder="请按原合同文字填写，不随主体档案改名"
        @change="emitOriginalName"
      />
    </label>
    <label>
      <span>系统匹配主体</span>
      <t-select
        :value="companyEntityId"
        :options="selectOptions"
        :disabled="disabled"
        :loading="loading"
        clearable
        filterable
        placeholder="可匹配启用、停用或资料待补全主体"
        @change="emitCompanyEntityId"
      />
    </label>
    <div class="historical-company-match__hint">
      <t-tag
        size="small"
        :theme="status.tone"
        variant="light"
      >
        {{ status.label }}
      </t-tag>
      <span>匹配只用于还原历史责任主体，不会改写原合同名称或扫描件。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { HistoricalCompanyEntityCandidateReadModel } from "../../../api/core-flow-read.api";
import {
  companyEntityMatchOptionLabel,
  companyEntityMatchStatus
} from "../contract-takeover.config";

const props = withDefaults(
  defineProps<{
    companyEntityId: string;
    originalName: string;
    candidates: HistoricalCompanyEntityCandidateReadModel[];
    loading?: boolean;
    disabled?: boolean;
  }>(),
  { loading: false, disabled: false }
);

const emit = defineEmits<{
  "update:companyEntityId": [value: string];
  "update:originalName": [value: string];
}>();

const selected = computed(() =>
  props.candidates.find((candidate) => candidate.id === props.companyEntityId)
);
const status = computed(() => companyEntityMatchStatus(selected.value));
const selectOptions = computed(() =>
  props.candidates.map((candidate) => ({
    value: candidate.id,
    label: companyEntityMatchOptionLabel(candidate)
  }))
);

function emitCompanyEntityId(value: string | number | undefined) {
  emit("update:companyEntityId", typeof value === "string" ? value : "");
}

function emitOriginalName(value: string | number) {
  emit("update:originalName", String(value));
}
</script>

<style scoped>
.historical-company-match {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.historical-company-match label {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-sm);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
}

.historical-company-match__hint {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: var(--jg-space-sm);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

@media (max-width: 900px) {
  .historical-company-match {
    grid-template-columns: 1fr;
  }

  .historical-company-match__hint {
    grid-column: 1;
  }
}
</style>

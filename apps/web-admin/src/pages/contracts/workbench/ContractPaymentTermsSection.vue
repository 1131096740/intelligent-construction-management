<template>
  <div class="workbench-section">
    <h2 class="section-title">付款方式及约定</h2>
    <label class="field">
      <span class="field-label">付款时间、比例与条件</span>
      <t-textarea
        :value="model.paymentTermsOriginalText"
        data-field-key="paymentTerms"
        :disabled="disabled"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="按实际约定填写付款时间、比例和条件，可留空待补充"
        @change="(value: string) => emit('update', { paymentTermsOriginalText: value })"
      />
    </label>
    <p class="field-help">按合同原文记录，供业务人员核对；系统不据此自动判断验收、付款条件或执行付款。</p>
  </div>
</template>

<script setup lang="ts">
import type { ContractSettlementMode } from "@jiangkong/shared-domain";
import type { ContractDraftModel } from "./use-contract-draft";
defineProps<{
  model: ContractDraftModel;
  contractTypeKey: string;
  settlementMode?: ContractSettlementMode | null;
  disabled: boolean;
}>();
const emit = defineEmits<{ (event: "update", patch: Partial<ContractDraftModel>): void }>();
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--jg-text-strong);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: var(--jg-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.checkbox-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  color: var(--jg-text-main);
  font-size: 13px;
}

.checkbox-row :deep(.t-checkbox) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>

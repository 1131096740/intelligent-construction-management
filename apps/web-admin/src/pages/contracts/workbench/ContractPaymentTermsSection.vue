<template>
  <div class="workbench-section">
    <h2 class="section-title">
      付款条款
    </h2>

    <label class="field">
      <span class="field-label">付款条款原文摘要</span>
      <t-textarea
        :value="model.paymentTermsOriginalText"
        :disabled="disabled"
        :autosize="{ minRows: 3, maxRows: 6 }"
        placeholder="粘贴合同中与付款比例、期限、发票、分次付款有关的原文摘要"
        @change="(value: string) => emit('update', { paymentTermsOriginalText: value })"
      />
    </label>

    <div class="field-grid">
      <label class="field">
        <span class="field-label">{{ ratioLabel }}</span>
        <t-input
          :value="ratioPercentText"
          :disabled="disabled"
          placeholder="如 80"
          @change="onRatioChange"
        />
      </label>

      <label class="field">
        <span class="field-label">{{ dueDaysLabel }}</span>
        <t-input
          :value="dueDaysText"
          :disabled="disabled"
          placeholder="如 30"
          @change="onDueDaysChange"
        />
      </label>
    </div>

    <div class="checkbox-row">
      <t-checkbox
        :checked="model.paymentRequiresInvoice"
        :disabled="disabled"
        @change="(checked: boolean) => emit('update', { paymentRequiresInvoice: checked })"
      >
        付款前需收到合规发票
      </t-checkbox>
      <t-checkbox
        :checked="model.paymentAllowsInstallments"
        :disabled="disabled"
        @change="(checked: boolean) => emit('update', { paymentAllowsInstallments: checked })"
      >
        允许分次付款
      </t-checkbox>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  contractTypeKey: string;
  disabled: boolean;
}>();

const emit = defineEmits<{ (event: "update", patch: Partial<ContractDraftModel>): void }>();

const ratioPercentText = computed(() =>
  props.model.paymentRatioBps === null ? "" : String(props.model.paymentRatioBps / 100)
);
const dueDaysText = computed(() =>
  props.model.paymentDueDays === null ? "" : String(props.model.paymentDueDays)
);
const ratioLabel = computed(() =>
  props.contractTypeKey === "generic_contract"
    ? "合同可付款比例（%）"
    : "当期结算款比例（%）"
);
const dueDaysLabel = computed(() =>
  props.contractTypeKey === "generic_contract"
    ? "合同生效后付款期限（天）"
    : "结算生效后付款期限（天）"
);

function onRatioChange(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    emit("update", { paymentRatioBps: null });
    return;
  }
  const ratio = Number(trimmed);
  emit("update", {
    paymentRatioBps: Number.isFinite(ratio) ? Math.round(ratio * 100) : null
  });
}

function onDueDaysChange(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    emit("update", { paymentDueDays: null });
    return;
  }
  const days = Number.parseInt(trimmed, 10);
  emit("update", { paymentDueDays: Number.isInteger(days) ? days : null });
}

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

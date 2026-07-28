<template>
  <div class="workbench-section tax-facts-section">
    <div class="section-heading">
      <div>
        <h2 class="section-title">
          发票与税率
        </h2>
        <p class="section-hint">
          以下内容将随合同版本保存，并作为清单、合同文档和后续结算的税务事实。
        </p>
      </div>
      <t-tag variant="outline">
        {{ statusLabel }}
      </t-tag>
    </div>

    <div class="field-grid">
      <label class="field">
        <span class="field-label">发票类型 <em class="required">*</em></span>
        <t-select
          :value="model.invoiceType ?? undefined"
          :options="contractInvoiceTypeOptions"
          :disabled="disabled"
          placeholder="选择增值税发票类型"
          @change="updateInvoiceType"
        />
      </label>

      <label class="field">
        <span class="field-label">计税模式 <em class="required">*</em></span>
        <t-select
          :value="model.taxMode"
          :options="contractTaxModeOptions"
          :disabled="disabled"
          placeholder="选择计税模式"
          @change="updateTaxMode"
        />
        <small class="field-help">通常选择单一税率；只有同一合同确有多个税率时才使用特殊多税率。</small>
      </label>
    </div>

    <div class="rate-fields">
      <label class="field">
        <span class="field-label">
          {{ model.taxMode === "multiple_rate" ? "合同默认税率" : "合同税率" }}
          <em class="required">*</em>
        </span>
        <t-select
          :value="quickRate"
          :options="taxRateQuickOptions"
          :disabled="disabled"
          placeholder="选择常用税率"
          @change="updateQuickRate"
        />
      </label>

      <label
        v-if="quickRate === 'other'"
        class="field"
      >
        <span class="field-label">其他税率（%） <em class="required">*</em></span>
        <t-input
          :value="model.defaultTaxRatePercent ?? ''"
          :disabled="disabled"
          placeholder="请输入 0 到 100 之间的税率"
          @change="updateOtherRate"
        />
        <small class="field-help">税率最多保留 6 位小数。</small>
      </label>
    </div>

    <p
      v-if="validationMessage"
      class="validation-message"
    >
      {{ validationMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  contractTaxFactStatusLabel,
  type ContractInvoiceType,
  type ContractTaxMode,
  type ContractWorkbenchReadModel
} from "@jiangkong/shared-domain";
import { computed, ref, watch } from "vue";
import {
  contractInvoiceTypeOptions,
  contractTaxModeOptions,
  resolveTaxRatePercent,
  taxFactsDisabledReason,
  taxRateQuickOptions,
  taxRateQuickValueFor,
  type TaxRateQuickValue
} from "./contract-tax-facts.state";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();

const quickRate = ref<TaxRateQuickValue>("other");
const statusLabel = computed(() =>
  contractTaxFactStatusLabel(props.workbench?.version.taxFacts.status ?? "draft")
);

watch(
  () => props.model.defaultTaxRatePercent,
  (rate) => {
    quickRate.value = taxRateQuickValueFor(rate ?? "");
  },
  { immediate: true }
);
const validationMessage = computed(() =>
  taxFactsDisabledReason({
    invoiceType: props.model.invoiceType,
    taxMode: props.model.taxMode,
    rate: props.model.defaultTaxRatePercent ?? ""
  })
);

function updateInvoiceType(value: string) {
  emit("update", { invoiceType: value as ContractInvoiceType });
}

function updateTaxMode(value: string) {
  emit("update", { taxMode: value as ContractTaxMode });
}

function updateQuickRate(value: string) {
  const quickValue = value as TaxRateQuickValue;
  quickRate.value = quickValue;
  emit("update", {
    defaultTaxRatePercent:
      quickValue === "other"
        ? null
        : resolveTaxRatePercent(quickValue, "")
  });
}

function updateOtherRate(value: string) {
  emit("update", { defaultTaxRatePercent: value.trim() || null });
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: var(--jg-space-lg);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-lg);
}

.section-title {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
  font-weight: 700;
}

.section-hint {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
  line-height: 1.6;
}

.field-grid,
.rate-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--jg-space-lg);
}

.field {
  display: grid;
  align-content: start;
  gap: var(--jg-space-sm);
}

.field-label {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-summary-label);
  font-weight: 600;
}

.field-help {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  line-height: 1.5;
}

.required,
.validation-message {
  color: var(--jg-color-danger);
}

.required {
  font-style: normal;
}

.validation-message {
  margin: 0;
  font-size: var(--jg-font-size-meta);
}
</style>

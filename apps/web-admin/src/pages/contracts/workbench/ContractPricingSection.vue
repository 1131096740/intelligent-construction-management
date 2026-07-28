<template>
  <div class="workbench-section">
    <h2 class="section-title">
      计价与金额
    </h2>

    <div class="field-grid">
      <label class="field">
        <span class="field-label">计价性质</span>
        <t-select
          :value="model.pricingNature"
          :options="pricingNatureOptions"
          :disabled="disabled"
          placeholder="选择计价性质"
          @change="updatePricingNature"
        />
      </label>

      <div class="field">
        <span class="field-label">金额来源</span>
        <div class="readonly-value">
          {{ amountSourceLabel }}
        </div>
      </div>

      <label
        v-if="policyKind === 'fixed_total_without_bill'"
        class="field"
      >
        <span class="field-label">含税合同总价（元）</span>
        <t-input
          v-model="manualAmountYuanText"
          data-field-key="manualAmountCents"
          :disabled="disabled"
          placeholder="请输入含税合同总价"
          @change="onManualAmountChange"
        />
      </label>

      <div
        v-else-if="policyKind === 'priced_bill'"
        class="field"
      >
        <span class="field-label">清单含税合计（元）</span>
        <div class="readonly-value amount-value">
          {{ derivedAmountYuanText || "—" }}
        </div>
        <small class="field-help">
          {{ derivedAmountYuanText ? "由后端按清单行逐行计算并汇总。" : "请先在合同清单中录入并保存计价项目。" }}
        </small>
      </div>
    </div>

    <div
      v-if="policyKind === 'unlimited_framework'"
      class="framework-note"
    >
      <strong>不设合同总价；按实际发生量结算</strong>
      <span>清单中的含税单价是合同事实，预计数量和预计金额仅供参考，不形成合同上限。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed, ref, watch } from "vue";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";
import type { ContractDraftModel } from "./use-contract-draft";

type PricingPolicyKind =
  | "fixed_total_without_bill"
  | "priced_bill"
  | "unlimited_framework";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{ (event: "update", patch: Partial<ContractDraftModel>): void }>();

const pricingNatureOptions = [
  { label: "固定总价", value: "fixed_total" },
  { label: "暂定总价", value: "provisional_total" },
  { label: "单价计量", value: "unit_price" },
  { label: "框架协议", value: "framework" }
];
const amountSourceOptions = [
  { label: "手工录入含税总价", value: "manual" },
  { label: "由计价清单汇总", value: "bill_sum" }
];

const amountLimitType = computed(() => {
  const version = props.workbench?.version as unknown as { amountLimitType?: unknown } | undefined;
  return version?.amountLimitType === "unlimited" ? "unlimited" : "capped";
});
const hasPricedRows = computed(() =>
  (props.workbench?.bills ?? []).some((bill) => {
    const record = bill as unknown as { amountRole?: unknown; rows?: unknown[] };
    return (
      (record.amountRole === "included" || record.amountRole === "provisional") &&
      Array.isArray(record.rows) &&
      record.rows.length > 0
    );
  })
);
const policyKind = computed<PricingPolicyKind>(() =>
  pricingPolicyFor(props.model.pricingNature)
);
const amountSourceLabel = computed(() =>
  policyKind.value === "unlimited_framework"
    ? "不形成合同总价"
    : amountSourceOptions.find(
        (option) => option.value === amountSourceFor(policyKind.value)
      )?.label ?? "—"
);

function pricingPolicyFor(pricingNature: string): PricingPolicyKind {
  if (pricingNature === "framework" && amountLimitType.value === "unlimited") {
    return "unlimited_framework";
  }
  if (hasPricedRows.value || pricingNature !== "fixed_total") {
    return "priced_bill";
  }
  return "fixed_total_without_bill";
}

function amountSourceFor(policy: PricingPolicyKind): ContractDraftModel["amountSource"] {
  return policy === "fixed_total_without_bill" ? "manual" : "bill_sum";
}

function centsToYuanInput(cents: string | null): string {
  return cents === null ? "" : centsTextToYuanText(cents).replaceAll(",", "");
}

const manualAmountYuanText = ref("");

watch(
  () => props.model.manualAmountCents,
  (amountCents) => {
    manualAmountYuanText.value = centsToYuanInput(amountCents);
  },
  { immediate: true }
);

const derivedAmountYuanText = computed(() => {
  if (!hasPricedRows.value) {
    return "";
  }
  const cents = props.workbench?.version.amountCents ?? null;
  return cents === null ? "" : centsTextToYuanText(cents);
});

watch(
  [policyKind, () => props.model.amountSource, () => props.disabled],
  ([policy, currentSource, disabled]) => {
    const expectedSource = amountSourceFor(policy);
    if (!disabled && currentSource !== expectedSource) {
      emit("update", {
        amountSource: expectedSource,
        ...(expectedSource === "bill_sum" ? { manualAmountCents: null } : {})
      });
    }
  },
  { immediate: true }
);

function updatePricingNature(value: string) {
  const nextPolicy = pricingPolicyFor(value);
  emit("update", {
    pricingNature: value,
    amountSource: amountSourceFor(nextPolicy),
    ...(nextPolicy === "fixed_total_without_bill" ? {} : { manualAmountCents: null })
  });
}

function yuanTextToCents(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return yuanTextToCentsText(trimmed);
  } catch {
    return null;
  }
}

function onManualAmountChange(value: string) {
  emit("update", {
    amountSource: "manual",
    manualAmountCents: yuanTextToCents(value)
  });
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: var(--jg-space-lg);
}

.section-title {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
  font-weight: var(--jg-font-weight-bold);
}

.field-grid {
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
  font-weight: var(--jg-font-weight-semibold);
}

.field-help {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  line-height: var(--jg-line-height-body);
}

.readonly-value {
  display: flex;
  align-items: center;
  min-height: var(--jg-layout-control-height);
  padding: 0 var(--jg-space-md);
  color: var(--jg-color-text-secondary);
  background: var(--jg-color-bg-muted);
  border-radius: var(--jg-radius-control);
}

.amount-value {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
  font-weight: var(--jg-font-weight-semibold);
}

.framework-note {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md) var(--jg-space-lg);
  color: var(--jg-color-text-secondary);
  background: var(--jg-color-bg-subtle);
  border-left: var(--jg-border-width-accent) solid var(--jg-color-brand);
}

.framework-note span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  line-height: var(--jg-line-height-body);
}
</style>

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
          @change="(value: string) => emit('update', { pricingNature: value })"
        />
      </label>

      <label class="field">
        <span class="field-label">金额来源</span>
        <t-select
          :value="model.amountSource"
          :options="amountSourceOptions"
          :disabled="disabled"
          placeholder="选择金额来源"
          @change="(value: string) => emit('update', { amountSource: value })"
        />
      </label>

      <label
        v-if="model.amountSource === 'manual'"
        class="field"
      >
        <span class="field-label">手工金额（元）</span>
        <t-input
          :value="manualAmountYuanText"
          :disabled="disabled"
          placeholder="如 100000.00"
          @change="onManualAmountChange"
        />
      </label>

      <label
        v-else
        class="field"
      >
        <span class="field-label">系统金额（元，只读）</span>
        <t-input
          :value="derivedAmountYuanText"
          readonly
          :disabled="true"
        />
      </label>
    </div>

    <label
      v-if="model.amountSource === 'manual'"
      class="field reason"
    >
      <span class="field-label">金额调整原因</span>
      <t-input
        :value="model.amountAdjustmentReason"
        :disabled="disabled"
        placeholder="说明手工金额的依据（可选）"
        @change="(value: string) => emit('update', { amountAdjustmentReason: value })"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{ (event: "update", patch: Partial<ContractDraftModel>): void }>();

const pricingNatureOptions = [
  { label: "固定总价", value: "fixed_price" },
  { label: "单价计量", value: "unit_price" },
  { label: "成本加酬金", value: "cost_plus" }
];

const amountSourceOptions = [
  { label: "由清单汇总", value: "bill" },
  { label: "手工录入", value: "manual" }
];

// Money is computed in cents by the backend; the UI only formats for display
// and parses manual input back to integer cents. No float arithmetic on totals.
function centsToYuanText(cents: number | null): string {
  if (cents === null || Number.isNaN(cents)) {
    return "";
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.trunc(abs / 100);
  const fen = abs % 100;
  return `${negative ? "-" : ""}${yuan}.${String(fen).padStart(2, "0")}`;
}

const manualAmountYuanText = computed(() => centsToYuanText(props.model.manualAmountCents));

const derivedAmountYuanText = computed(() =>
  centsToYuanText(props.workbench?.version.amountCents ?? null)
);

function yuanTextToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const yuan = Number.parseInt(match[2], 10);
  const fen = Number.parseInt((match[3] ?? "0").padEnd(2, "0"), 10);
  return sign * (yuan * 100 + fen);
}

function onManualAmountChange(value: string) {
  emit("update", { manualAmountCents: yuanTextToCents(value) });
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
  color: #151922;
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

.field.reason {
  max-width: 480px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}
</style>

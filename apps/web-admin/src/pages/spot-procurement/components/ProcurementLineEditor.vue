<script setup lang="ts">
import { computed } from "vue";
import { centsTextToYuanText, calculateSpotProcurementLineAmountCents } from "../../../lib/money";

export interface ProcurementLineDraft {
  materialName: string;
  specification: string;
  unit: string;
  quantity: string;
  invoiceMode: "invoice" | "no_invoice";
  invoiceType: "vat_general" | "vat_special" | null;
  vatRateOptionId: string | null;
  unitPrice: string;
  usageLocation: string;
  note: string;
}

export interface VatRateOption {
  id: string;
  label: string;
  rateValue: string;
}

const props = withDefaults(defineProps<{
  modelValue: ProcurementLineDraft[];
  vatRateOptions?: VatRateOption[];
  readonly?: boolean;
}>(), {
  vatRateOptions: () => [],
  readonly: false
});

const emit = defineEmits<{
  "update:modelValue": [value: ProcurementLineDraft[]];
}>();

const columns = [
  { colKey: "materialName", title: "材料名称", width: 150 },
  { colKey: "specification", title: "规格型号", width: 130 },
  { colKey: "unit", title: "单位", width: 80 },
  { colKey: "quantity", title: "数量", width: 110 },
  { colKey: "invoiceMode", title: "票据方式", width: 110 },
  { colKey: "invoiceType", title: "发票类型", width: 120 },
  { colKey: "vatRateOptionId", title: "税率", width: 100 },
  { colKey: "unitPrice", title: "含税/无票单价", width: 130 },
  { colKey: "amount", title: "预览金额", width: 120 },
  { colKey: "usageLocation", title: "使用部位", width: 130 },
  { colKey: "note", title: "备注", width: 130 },
  { colKey: "operation", title: "操作", width: 70, fixed: "right" as const }
];

const invoiceModeOptions = [
  { label: "有发票", value: "invoice" },
  { label: "无发票", value: "no_invoice" }
];
const invoiceTypeOptions = [
  { label: "增值税普通发票", value: "vat_general" },
  { label: "增值税专用发票", value: "vat_special" }
];
const vatOptions = computed(() =>
  props.vatRateOptions.map((option) => ({
    label: option.label,
    value: option.id
  }))
);

function updateLine(
  index: number,
  patch: Partial<ProcurementLineDraft>
) {
  const next = props.modelValue.map((line, lineIndex) =>
    lineIndex === index ? { ...line, ...patch } : line
  );
  emit("update:modelValue", next);
}

function updateInvoiceMode(index: number, value: unknown) {
  const invoiceMode = value === "invoice" ? "invoice" : "no_invoice";
  updateLine(index, {
    invoiceMode,
    ...(invoiceMode === "no_invoice"
      ? {
          invoiceType: null,
          vatRateOptionId: null
        }
      : {})
  });
}

function addLine() {
  emit("update:modelValue", [
    ...props.modelValue,
    {
      materialName: "",
      specification: "",
      unit: "",
      quantity: "",
      invoiceMode: "invoice",
      invoiceType: "vat_general",
      vatRateOptionId: null,
      unitPrice: "",
      usageLocation: "",
      note: ""
    }
  ]);
}

function removeLine(index: number) {
  if (props.modelValue.length <= 1) return;
  emit(
    "update:modelValue",
    props.modelValue.filter((_line, lineIndex) => lineIndex !== index)
  );
}

function amountPreview(line: ProcurementLineDraft) {
  try {
    return `¥${centsTextToYuanText(
      calculateSpotProcurementLineAmountCents(
        line.quantity,
        line.unitPrice
      )
    )}`;
  } catch {
    return "待补全";
  }
}
</script>

<template>
  <section class="procurement-line-editor">
    <header>
      <div>
        <h3>材料明细</h3>
        <p>页面金额仅作即时预览，保存成功后以系统重算结果为准。</p>
      </div>
      <t-button
        v-if="!readonly"
        size="small"
        variant="outline"
        @click="addLine"
      >
        添加材料
      </t-button>
    </header>

    <t-table
      row-key="index"
      size="small"
      table-layout="fixed"
      :columns="columns"
      :data="modelValue.map((line, index) => ({ ...line, index }))"
      :scroll="{ x: 1410 }"
    >
      <template #materialName="{ row }">
        <t-input
          :value="row.materialName"
          :disabled="readonly"
          placeholder="如：免烧砖"
          @change="(value: unknown) => updateLine(row.index, { materialName: String(value ?? '') })"
        />
      </template>
      <template #specification="{ row }">
        <t-input
          :value="row.specification"
          :disabled="readonly"
          placeholder="规格型号"
          @change="(value: unknown) => updateLine(row.index, { specification: String(value ?? '') })"
        />
      </template>
      <template #unit="{ row }">
        <t-input
          :value="row.unit"
          :disabled="readonly"
          placeholder="块/吨/套"
          @change="(value: unknown) => updateLine(row.index, { unit: String(value ?? '') })"
        />
      </template>
      <template #quantity="{ row }">
        <t-input
          :value="row.quantity"
          :disabled="readonly"
          placeholder="最多6位小数"
          @change="(value: unknown) => updateLine(row.index, { quantity: String(value ?? '') })"
        />
      </template>
      <template #invoiceMode="{ row }">
        <t-select
          :value="row.invoiceMode"
          :disabled="readonly"
          :options="invoiceModeOptions"
          @change="(value: unknown) => updateInvoiceMode(row.index, value)"
        />
      </template>
      <template #invoiceType="{ row }">
        <t-select
          :value="row.invoiceType"
          :disabled="readonly || row.invoiceMode === 'no_invoice'"
          :options="invoiceTypeOptions"
          placeholder="选择类型"
          @change="(value: unknown) => updateLine(row.index, { invoiceType: value === 'vat_special' ? 'vat_special' : 'vat_general' })"
        />
      </template>
      <template #vatRateOptionId="{ row }">
        <t-select
          :value="row.vatRateOptionId"
          :disabled="readonly || row.invoiceMode === 'no_invoice'"
          :options="vatOptions"
          placeholder="选择税率"
          @change="(value: unknown) => updateLine(row.index, { vatRateOptionId: value ? String(value) : null })"
        />
      </template>
      <template #unitPrice="{ row }">
        <t-input
          :value="row.unitPrice"
          :disabled="readonly"
          placeholder="最多6位小数"
          @change="(value: unknown) => updateLine(row.index, { unitPrice: String(value ?? '') })"
        />
      </template>
      <template #amount="{ row }">
        <strong>{{ amountPreview(row) }}</strong>
      </template>
      <template #usageLocation="{ row }">
        <t-input
          :value="row.usageLocation"
          :disabled="readonly"
          placeholder="可选"
          @change="(value: unknown) => updateLine(row.index, { usageLocation: String(value ?? '') })"
        />
      </template>
      <template #note="{ row }">
        <t-input
          :value="row.note"
          :disabled="readonly"
          placeholder="如：免烧砖"
          @change="(value: unknown) => updateLine(row.index, { note: String(value ?? '') })"
        />
      </template>
      <template #operation="{ row }">
        <t-link
          v-if="!readonly"
          theme="danger"
          :disabled="modelValue.length <= 1"
          @click="removeLine(row.index)"
        >
          删除
        </t-link>
      </template>
    </t-table>
  </section>
</template>

<style scoped>
.procurement-line-editor {
  display: grid;
  gap: var(--jg-space-md);
  min-width: 0;
}

.procurement-line-editor > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.procurement-line-editor h3,
.procurement-line-editor p {
  margin: 0;
}

.procurement-line-editor h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.procurement-line-editor p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.procurement-line-editor strong {
  color: var(--jg-color-text-primary);
  white-space: nowrap;
}
</style>

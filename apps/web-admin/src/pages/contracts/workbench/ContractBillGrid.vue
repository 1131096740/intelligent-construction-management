<script setup lang="ts">
import type { ColumnRegular } from "@revolist/vue3-datagrid";
import { isContractBillCustomColumn } from "@jiangkong/shared-domain";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import {
  billColumns,
  inheritedTaxRateText,
  type WorkbenchBill,
  type WorkbenchBillColumn
} from "./contract-bill-editor";
import type {
  ContractBillCandidateRow,
  ContractBillCellError
} from "./contract-bill-grid";

const props = defineProps<{
  bill: WorkbenchBill;
  rows: ContractBillCandidateRow[];
  errors: ContractBillCellError[];
  readonly: boolean;
}>();

const emit = defineEmits<{
  "update:rows": [rows: ContractBillCandidateRow[]];
  "select-row": [clientRowKey: string];
}>();

interface EditableColumn extends WorkbenchBillColumn {
  size: number;
}

const coreColumns: EditableColumn[] = [
  { key: "itemCode", label: "编码", size: 120 },
  { key: "itemName", label: "名称", required: true, size: 180 },
  { key: "specification", label: "规格型号", size: 150 },
  { key: "unit", label: "单位", required: true, size: 96 },
  { key: "quantity", label: "数量", required: true, size: 120 },
  { key: "unitPrice", label: "含税单价", required: true, size: 140 },
  { key: "taxRateSource", label: "税率来源", size: 140 },
  { key: "taxRatePercent", label: "税率（%）", required: true, size: 120 },
  { key: "isProvisional", label: "暂定项", size: 96 },
  { key: "settlementBasis", label: "结算依据", size: 180 }
];

const taxRateSourceOptions = [
  { label: "使用合同税率", value: "version_default" },
  { label: "使用例外税率", value: "row_override" }
];

const isMobile = ref(
  typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
);
const nextErrorIndex = ref(0);
let mobileQuery: MediaQueryList | null = null;

const customColumns = computed<EditableColumn[]>(() =>
  billColumns(props.bill)
    .filter((column) => isContractBillCustomColumn(column.key))
    .map((column) => ({ ...column, size: 160 }))
);

const editableColumns = computed(() => [...coreColumns, ...customColumns.value]);
const errorLookup = computed(() =>
  new Map(props.errors.map((error) => [cellKey(error.clientRowKey, error.field), error]))
);
const gridRows = computed<JgBusinessGridRow[]>(() => props.rows.map(toGridRow));
const columns = computed<ColumnRegular[]>(() =>
  editableColumns.value.map((column) => ({
    prop: column.key,
    name: column.required ? `${column.label} *` : column.label,
    size: column.size,
    readonly: ({ model }) => isReadonlyCell(column.key, model as JgBusinessGridRow),
    cellProperties: ({ model }) => {
      const clientRowKey = String((model as JgBusinessGridRow).clientRowKey ?? "");
      const error = errorLookup.value.get(cellKey(clientRowKey, column.key));
      if (!error) return undefined;
      return {
        className: "contract-bill-grid__cell--error",
        "aria-invalid": "true",
        "data-cell-error": cellKey(clientRowKey, column.key),
        title: error.message
      };
    }
  }))
);

onMounted(() => {
  mobileQuery = window.matchMedia("(max-width: 767px)");
  updateMobileMode();
  mobileQuery.addEventListener("change", updateMobileMode);
});

onBeforeUnmount(() => {
  mobileQuery?.removeEventListener("change", updateMobileMode);
  mobileQuery = null;
});

function updateMobileMode() {
  isMobile.value = mobileQuery?.matches ?? false;
}

function toGridRow(row: ContractBillCandidateRow): JgBusinessGridRow {
  return {
    clientRowKey: row.clientRowKey,
    itemCode: row.itemCode,
    itemName: row.itemName,
    specification: row.specification,
    unit: row.unit,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    taxRateSource: row.taxRateSource,
    taxRatePercent: row.taxRatePercent,
    isProvisional: row.isProvisional ? "true" : "false",
    settlementBasis: row.settlementBasis,
    ...row.customData
  };
}

function onGridRowsChanged(value: JgBusinessGridRow[]) {
  const byClientKey = new Map(props.rows.map((row) => [row.clientRowKey, row]));
  emit("update:rows", value.flatMap((gridRow, index) => {
    const clientRowKey = gridRow.clientRowKey ?? "";
    const current = byClientKey.get(clientRowKey) ?? props.rows[index];
    return current ? [candidateFromGridRow(current, gridRow)] : [];
  }));
}

function candidateFromGridRow(
  current: ContractBillCandidateRow,
  gridRow: JgBusinessGridRow
): ContractBillCandidateRow {
  const taxRateSource =
    props.bill.taxMode === "multiple_rate" && gridRow.taxRateSource === "row_override"
      ? "row_override"
      : "version_default";
  return {
    ...current,
    itemCode: text(gridRow.itemCode),
    itemName: text(gridRow.itemName),
    specification: text(gridRow.specification),
    unit: text(gridRow.unit),
    quantity: text(gridRow.quantity),
    unitPrice: text(gridRow.unitPrice),
    taxRateSource,
    taxRatePercent: taxRateSource === "row_override"
      ? text(gridRow.taxRatePercent)
      : props.bill.defaultTaxRatePercent ?? "",
    isProvisional: booleanValue(gridRow.isProvisional),
    settlementBasis: text(gridRow.settlementBasis),
    customData: {
      ...current.customData,
      ...Object.fromEntries(
        customColumns.value.map((column) => [column.key, text(gridRow[column.key])])
      )
    }
  };
}

function updateMobileCell(
  clientRowKey: string,
  field: string,
  value: string | boolean
) {
  emit("update:rows", props.rows.map((row) => {
    if (row.clientRowKey !== clientRowKey) return row;
    if (isContractBillCustomColumn(field)) {
      return {
        ...row,
        customData: { ...row.customData, [field]: String(value ?? "") }
      };
    }
    if (field === "taxRateSource") {
      const taxRateSource =
        props.bill.taxMode === "multiple_rate" && value === "row_override"
          ? "row_override"
          : "version_default";
      return {
        ...row,
        taxRateSource,
        taxRatePercent: taxRateSource === "version_default"
          ? props.bill.defaultTaxRatePercent ?? ""
          : ""
      };
    }
    if (field === "isProvisional") {
      return { ...row, isProvisional: booleanValue(value) };
    }
    return { ...row, [field]: String(value ?? "") };
  }));
}

function selectError(error: ContractBillCellError) {
  emit("select-row", error.clientRowKey);
}

function selectNextError() {
  if (!props.errors.length) return;
  const index = nextErrorIndex.value % props.errors.length;
  selectError(props.errors[index]!);
  nextErrorIndex.value = (index + 1) % props.errors.length;
}

function errorFor(clientRowKey: string, field: string) {
  return errorLookup.value.get(cellKey(clientRowKey, field));
}

function cellErrorKey(clientRowKey: string, field: string) {
  return errorFor(clientRowKey, field) ? cellKey(clientRowKey, field) : undefined;
}

function errorRowNumber(clientRowKey: string) {
  const index = props.rows.findIndex((row) => row.clientRowKey === clientRowKey);
  return index >= 0 ? index + 1 : "未知";
}

function isReadonlyCell(field: string, row: JgBusinessGridRow) {
  if (props.readonly) return true;
  if (field === "taxRateSource") return props.bill.taxMode !== "multiple_rate";
  if (field === "taxRatePercent") {
    return props.bill.taxMode !== "multiple_rate" || row.taxRateSource !== "row_override";
  }
  return false;
}

function inheritedTaxRate(row: ContractBillCandidateRow) {
  return row.taxRateSource === "row_override"
    ? row.taxRatePercent
    : inheritedTaxRateText(props.bill);
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === "1" || value === "是";
}

function cellKey(clientRowKey: string, field: string) {
  return `${clientRowKey}:${field}`;
}
</script>

<template>
  <section class="contract-bill-grid">
    <t-alert
      v-if="errors.length"
      theme="error"
      title="清单校验未通过"
    >
      <div class="contract-bill-grid__error-summary">
        <span>共 {{ errors.length }} 处需修正</span>
        <t-button
          size="small"
          variant="outline"
          data-action="next-error"
          @click="selectNextError"
        >
          下一处错误
        </t-button>
      </div>
      <ul class="contract-bill-grid__error-list">
        <li
          v-for="error in errors"
          :key="cellKey(error.clientRowKey, error.field)"
        >
          <t-button
            size="small"
            variant="text"
            class="contract-bill-grid__error-link"
            :data-cell-error="cellKey(error.clientRowKey, error.field)"
            @click="selectError(error)"
          >
            第 {{ errorRowNumber(error.clientRowKey) }} 行 · {{ error.message }}
          </t-button>
        </li>
      </ul>
    </t-alert>

    <JgBusinessGrid
      v-if="!isMobile"
      :source="gridRows"
      :columns="columns"
      :readonly="readonly"
      :min-height="520"
      @update:source="onGridRowsChanged"
    />

    <div
      v-else
      class="contract-bill-grid__cards"
    >
      <t-card
        v-for="(row, index) in rows"
        :key="row.clientRowKey"
        class="contract-bill-grid__card"
      >
        <template #title>
          第 {{ index + 1 }} 行
        </template>

        <div class="contract-bill-grid__card-fields">
          <label class="contract-bill-grid__field">
            <span>编码</span>
            <t-input
              :model-value="row.itemCode"
              :disabled="readonly"
              data-field="itemCode"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'itemCode')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'itemCode'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'itemCode', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>名称 *</span>
            <t-input
              :model-value="row.itemName"
              :disabled="readonly"
              data-field="itemName"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'itemName')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'itemName'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'itemName', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>规格型号</span>
            <t-input
              :model-value="row.specification"
              :disabled="readonly"
              data-field="specification"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'specification')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'specification'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'specification', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>单位 *</span>
            <t-input
              :model-value="row.unit"
              :disabled="readonly"
              data-field="unit"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'unit')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'unit'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'unit', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>数量 *</span>
            <t-input
              :model-value="row.quantity"
              :disabled="readonly"
              data-field="quantity"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'quantity')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'quantity'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'quantity', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>含税单价 *</span>
            <t-input
              :model-value="row.unitPrice"
              :disabled="readonly"
              data-field="unitPrice"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'unitPrice')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'unitPrice'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'unitPrice', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>税率来源</span>
            <t-select
              :model-value="row.taxRateSource"
              :options="taxRateSourceOptions"
              :disabled="readonly || bill.taxMode !== 'multiple_rate'"
              data-field="taxRateSource"
              :data-client-row-key="row.clientRowKey"
              @update:model-value="updateMobileCell(row.clientRowKey, 'taxRateSource', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>税率（%）*</span>
            <t-input
              :model-value="inheritedTaxRate(row)"
              :disabled="readonly || bill.taxMode !== 'multiple_rate' || row.taxRateSource !== 'row_override'"
              data-field="taxRatePercent"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'taxRatePercent')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'taxRatePercent'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'taxRatePercent', String($event))"
            />
          </label>
          <label class="contract-bill-grid__field">
            <span>暂定项</span>
            <t-checkbox
              :model-value="row.isProvisional"
              :disabled="readonly"
              data-field="isProvisional"
              :data-client-row-key="row.clientRowKey"
              @update:model-value="updateMobileCell(row.clientRowKey, 'isProvisional', Boolean($event))"
            >
              是
            </t-checkbox>
          </label>
          <label class="contract-bill-grid__field">
            <span>结算依据</span>
            <t-input
              :model-value="row.settlementBasis"
              :disabled="readonly"
              data-field="settlementBasis"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, 'settlementBasis')"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, 'settlementBasis'))"
              @update:model-value="updateMobileCell(row.clientRowKey, 'settlementBasis', String($event))"
            />
          </label>
          <label
            v-for="column in customColumns"
            :key="column.key"
            class="contract-bill-grid__field"
          >
            <span>{{ column.label }}{{ column.required ? " *" : "" }}</span>
            <t-input
              :model-value="row.customData[column.key] ?? ''"
              :disabled="readonly"
              :data-field="column.key"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, column.key)"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, column.key))"
              @update:model-value="updateMobileCell(row.clientRowKey, column.key, String($event))"
            />
          </label>
        </div>
      </t-card>
    </div>
  </section>
</template>

<style scoped>
.contract-bill-grid {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-md);
}

.contract-bill-grid__error-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.contract-bill-grid__error-list {
  display: grid;
  margin: var(--jg-space-sm) 0 0;
  padding-left: var(--jg-space-lg-plus);
  gap: var(--jg-space-xs);
}

.contract-bill-grid__error-link {
  padding: 0;
  border: 0;
  color: var(--jg-color-danger);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.contract-bill-grid__cards {
  display: grid;
  gap: var(--jg-space-md);
}

.contract-bill-grid__card-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.contract-bill-grid__field {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-xs);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.contract-bill-grid :deep(.contract-bill-grid__cell--error) {
  outline: var(--jg-border-width-base) solid var(--jg-color-danger);
  outline-offset: calc(-1 * var(--jg-border-width-base));
  background: var(--jg-color-danger-soft);
}

@media (max-width: 520px) {
  .contract-bill-grid__card-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

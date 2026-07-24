<script lang="ts">
export function advanceContractBillErrorCursor<T extends {
  clientRowKey: string;
  field: string;
}>(
  currentIndex: number,
  previousSignature: string,
  errors: readonly T[]
) {
  const signature = JSON.stringify(
    errors.map((error) => [error.clientRowKey, error.field])
  );
  if (!errors.length) {
    return { error: null, nextIndex: 0, signature };
  }
  const index = signature === previousSignature
    ? currentIndex % errors.length
    : 0;
  return {
    error: errors[index]!,
    nextIndex: (index + 1) % errors.length,
    signature
  };
}
</script>

<script setup lang="ts">
import type { ColumnRegular } from "@revolist/vue3-datagrid";
import { isContractBillCustomColumn } from "@jiangkong/shared-domain";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
const errorListSignature = ref("");
const editorErrors = ref<ContractBillCellError[]>([]);
let mobileQuery: MediaQueryList | null = null;

const configuredColumns = computed(() => billColumns(props.bill));
const customColumns = computed<EditableColumn[]>(() =>
  configuredColumns.value
    .filter((column) => isContractBillCustomColumn(column.key))
    .map((column) => ({ ...column, size: 160 }))
);

const resolvedCoreColumns = computed(() => coreColumns.map((column) => {
  const configured = configuredColumns.value.find((candidate) => candidate.key === column.key);
  return configured
    ? { ...column, label: configured.label, required: configured.required }
    : column;
}));
const quantityColumn = computed(() =>
  resolvedCoreColumns.value.find((column) => column.key === "quantity") ?? coreColumns[4]!
);
const editableColumns = computed(() => [...resolvedCoreColumns.value, ...customColumns.value]);
const displayErrors = computed(() =>
  Array.from(
    new Map(
      [...props.errors, ...editorErrors.value].map((error) => [
        cellKey(error.clientRowKey, error.field),
        error
      ])
    ).values()
  )
);
const errorLookup = computed(() =>
  new Map(displayErrors.value.map((error) => [cellKey(error.clientRowKey, error.field), error]))
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

watch(
  () => props.errors,
  () => {
    nextErrorIndex.value = 0;
    errorListSignature.value = "";
  },
  { flush: "sync" }
);

function updateMobileMode() {
  isMobile.value = mobileQuery?.matches ?? false;
}

function toGridRow(row: ContractBillCandidateRow): JgBusinessGridRow {
  const customData = Object.fromEntries(customColumns.value.map((column) => [
    column.key,
    column.type === "boolean"
      ? booleanText(row.customData[column.key])
      : text(row.customData[column.key])
  ]));
  return {
    ...customData,
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
    settlementBasis: row.settlementBasis
  };
}

function onGridRowsChanged(value: JgBusinessGridRow[]) {
  const byClientKey = new Map(props.rows.map((row) => [row.clientRowKey, row]));
  const nextErrors: ContractBillCellError[] = [];
  const rows = value.flatMap((gridRow, index) => {
    const clientRowKey = gridRow.clientRowKey ?? "";
    const current = byClientKey.get(clientRowKey) ?? props.rows[index];
    return current ? [candidateFromGridRow(current, gridRow, nextErrors)] : [];
  });
  editorErrors.value = nextErrors;
  emit("update:rows", rows);
}

function candidateFromGridRow(
  current: ContractBillCandidateRow,
  gridRow: JgBusinessGridRow,
  errors: ContractBillCellError[]
): ContractBillCandidateRow {
  const taxRateSource = gridRow.taxRateSource === "version_default" ||
    (props.bill.taxMode === "multiple_rate" && gridRow.taxRateSource === "row_override")
    ? gridRow.taxRateSource
    : invalidGridValue(
      errors,
      current,
      "taxRateSource",
      "税率来源只能选择使用合同税率或使用例外税率",
      current.taxRateSource
    );
  const provisional = parseBooleanText(gridRow.isProvisional);
  if (provisional === null) {
    addEditorError(errors, current.clientRowKey, "isProvisional", "暂定项只能填写“是”或“否”");
  }
  const nextCustomData = { ...current.customData };
  for (const column of customColumns.value) {
    if (column.type !== "boolean") {
      nextCustomData[column.key] = text(gridRow[column.key]);
      continue;
    }
    const normalized = parseBooleanText(gridRow[column.key]);
    if (normalized === null) {
      if (!column.required && !text(gridRow[column.key]).trim()) {
        delete nextCustomData[column.key];
        continue;
      }
      addEditorError(
        errors,
        current.clientRowKey,
        column.key,
        `${column.label}只能填写“是”或“否”`
      );
      continue;
    }
    nextCustomData[column.key] = normalized ? "true" : "false";
  }
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
    isProvisional: provisional ?? current.isProvisional,
    settlementBasis: text(gridRow.settlementBasis),
    customData: nextCustomData
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
      const column = customColumns.value.find((candidate) => candidate.key === field);
      if (column?.type === "boolean") {
        const normalized = parseBooleanText(value);
        if (normalized === null) {
          setMobileEditorError(clientRowKey, field, `${column.label}只能选择“是”或“否”`);
          return row;
        }
        clearMobileEditorError(clientRowKey, field);
        return {
          ...row,
          customData: {
            ...row.customData,
            [field]: normalized ? "true" : "false"
          }
        };
      }
      return {
        ...row,
        customData: { ...row.customData, [field]: String(value ?? "") }
      };
    }
    if (field === "taxRateSource") {
      if (
        value !== "version_default" &&
        (props.bill.taxMode !== "multiple_rate" || value !== "row_override")
      ) {
        setMobileEditorError(
          clientRowKey,
          field,
          "税率来源只能选择使用合同税率或使用例外税率"
        );
        return row;
      }
      clearMobileEditorError(clientRowKey, field);
      const taxRateSource = value;
      return {
        ...row,
        taxRateSource,
        taxRatePercent: taxRateSource === "version_default"
          ? props.bill.defaultTaxRatePercent ?? ""
          : ""
      };
    }
    if (field === "isProvisional") {
      const normalized = parseBooleanText(value);
      if (normalized === null) {
        setMobileEditorError(clientRowKey, field, "暂定项只能选择“是”或“否”");
        return row;
      }
      clearMobileEditorError(clientRowKey, field);
      return { ...row, isProvisional: normalized };
    }
    return { ...row, [field]: String(value ?? "") };
  }));
}

function selectError(error: ContractBillCellError) {
  emit("select-row", error.clientRowKey);
}

function selectNextError() {
  const cursor = advanceContractBillErrorCursor(
    nextErrorIndex.value,
    errorListSignature.value,
    displayErrors.value
  );
  if (!cursor.error) return;
  selectError(cursor.error);
  nextErrorIndex.value = cursor.nextIndex;
  errorListSignature.value = cursor.signature;
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

function parseBooleanText(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "1" || value === "是") return true;
  if (value === false || value === "false" || value === "0" || value === "否") return false;
  return null;
}

function booleanText(value: unknown) {
  const normalized = parseBooleanText(value);
  return normalized === null ? text(value) : normalized ? "true" : "false";
}

function invalidGridValue<T>(
  errors: ContractBillCellError[],
  row: ContractBillCandidateRow,
  field: string,
  message: string,
  current: T
) {
  addEditorError(errors, row.clientRowKey, field, message);
  return current;
}

function addEditorError(
  errors: ContractBillCellError[],
  clientRowKey: string,
  field: string,
  message: string
) {
  errors.push({ clientRowKey, field, message });
}

function setMobileEditorError(clientRowKey: string, field: string, message: string) {
  clearMobileEditorError(clientRowKey, field);
  editorErrors.value = [...editorErrors.value, { clientRowKey, field, message }];
}

function clearMobileEditorError(clientRowKey: string, field: string) {
  editorErrors.value = editorErrors.value.filter(
    (error) => error.clientRowKey !== clientRowKey || error.field !== field
  );
}

function cellKey(clientRowKey: string, field: string) {
  return `${clientRowKey}:${field}`;
}
</script>

<template>
  <section class="contract-bill-grid">
    <t-alert
      v-if="displayErrors.length"
      theme="error"
      title="清单校验未通过"
    >
      <div class="contract-bill-grid__error-summary">
        <span>共 {{ displayErrors.length }} 处需修正</span>
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
          v-for="error in displayErrors"
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
            <span>{{ quantityColumn.label }}{{ quantityColumn.required ? " *" : "" }}</span>
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
            <t-checkbox
              v-if="column.type === 'boolean'"
              :model-value="parseBooleanText(row.customData[column.key]) === true"
              :disabled="readonly"
              :data-field="column.key"
              :data-client-row-key="row.clientRowKey"
              :data-cell-error="cellErrorKey(row.clientRowKey, column.key)"
              :aria-invalid="Boolean(errorFor(row.clientRowKey, column.key))"
              @update:model-value="updateMobileCell(row.clientRowKey, column.key, Boolean($event))"
            >
              是
            </t-checkbox>
            <t-input
              v-else
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

<template>
  <div class="bill-editor">
    <div class="toolbar">
      <div class="total">
        <span>{{ unlimitedFramework ? "预计含税合计" : "含税合计" }}</span>
        <strong>{{ totalText }}</strong>
        <small v-if="unlimitedFramework">仅供参考，不作为合同上限</small>
      </div>
      <div class="actions">
        <t-button
          size="small"
          variant="outline"
          :disabled="disabled || busy || hasUnsavedRow"
          @click="downloadTemplate"
        >
          下载模板
        </t-button>
        <t-upload
          v-model="importFiles"
          theme="file-input"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          :auto-upload="false"
          :max="1"
          :loading="busy"
          :disabled="disabled || busy || hasUnsavedRow"
          placeholder="选择 XLSX 并预览"
          @change="previewImport"
        />
        <t-button
          size="small"
          theme="primary"
          :disabled="disabled || busy || hasUnsavedRow || !canApply"
          @click="applyImport"
        >
          应用导入
        </t-button>
      </div>
    </div>

    <t-dialog
      v-model:visible="previewVisible"
      header="导入预览"
      width="640px"
      :footer="false"
    >
      <div class="preview-dialog">
        <div class="import-summary">
          新增 {{ importCounts.added }} · 更新 {{ importCounts.updated }} · 移除
          {{ importCounts.removed }} · 跳过 {{ importCounts.skipped }} · 错误
          {{ importCounts.errors }}
        </div>
        <ul
          v-if="previewErrors.length"
          class="preview-list danger"
        >
          <li
            v-for="error in previewErrors"
            :key="error"
          >
            {{ error }}
          </li>
        </ul>
        <div
          v-if="previewRows.length"
          class="preview-rows"
        >
          <div
            v-for="(row, index) in previewRows"
            :key="index"
          >
            {{ previewRowText(row) }}
          </div>
        </div>
        <div class="dialog-actions">
          <t-button
            variant="outline"
            @click="previewVisible = false"
          >
            关闭
          </t-button>
          <t-button
            theme="primary"
            :disabled="disabled || busy || hasUnsavedRow || !canApply"
            @click="applyImport"
          >
            应用导入
          </t-button>
        </div>
      </div>
    </t-dialog>

    <div class="table-wrap jg-workspace-scroll">
      <table class="bill-table">
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
            >
              {{ column.label }}
            </th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in localRows"
            :key="row.rowKey"
          >
            <td
              v-for="column in columns"
              :key="column.key"
            >
              <div
                v-if="column.key === 'taxRatePercent'"
                class="tax-rate-cell"
              >
                <t-input
                  v-if="bill.taxMode !== 'multiple_rate'"
                  :value="inheritedTaxRateText(bill)"
                  disabled
                />
                <template v-else>
                  <t-select
                    :value="row.taxRateSource ?? 'version_default'"
                    :options="taxRateSourceOptions"
                    :disabled="disabled || busy"
                    @change="(value: string) => onTaxSourceChange(row.rowKey, value)"
                  />
                  <t-input
                    v-if="row.taxRateSource === 'row_override'"
                    :value="rowValue(row, column.key)"
                    :disabled="disabled || busy"
                    placeholder="例外税率%"
                    @change="(value: string) => onCellValue(row.rowKey, column.key, value)"
                  />
                  <span
                    v-else
                    class="inherited-rate"
                  >{{ inheritedTaxRateText(bill) }}</span>
                </template>
              </div>
              <t-input
                v-else
                :value="rowValue(row, column.key)"
                :disabled="disabled || busy"
                :placeholder="cellPlaceholder(column.key)"
                @change="(value: string) => onCellValue(row.rowKey, column.key, value)"
              />
            </td>
            <td class="row-actions">
              <t-button
                size="small"
                variant="text"
                :disabled="disabled || busy || (hasUnsavedRow && !isUnsavedBillRow(row))"
                @click="saveRow(row)"
              >
                保存
              </t-button>
              <t-button
                size="small"
                variant="text"
                :disabled="disabled || busy || hasUnsavedRow"
                @click="duplicateRow(row)"
              >
                复制
              </t-button>
              <t-button
                size="small"
                variant="text"
                :disabled="disabled || busy || hasUnsavedRow"
                @click="moveRow(row.rowKey, -1)"
              >
                上移
              </t-button>
              <t-button
                size="small"
                variant="text"
                :disabled="disabled || busy || hasUnsavedRow"
                @click="moveRow(row.rowKey, 1)"
              >
                下移
              </t-button>
              <t-button
                size="small"
                variant="text"
                theme="danger"
                :disabled="disabled || busy || (hasUnsavedRow && !isUnsavedBillRow(row))"
                @click="removeRow(row)"
              >
                删除
              </t-button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td :colspan="Math.max(columns.length - 1, 1)">
              合计
            </td>
            <td class="amount-cell">
              {{ totalText }}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="add-row">
      <t-button
        size="small"
        theme="primary"
        :disabled="disabled || busy || hasUnsavedRow"
        @click="addEmptyRow"
      >
        新增行
      </t-button>
      <span
        v-if="message"
        :class="['message', { danger: messageDanger }]"
      >
        {{ message }}
      </span>
      <span
        v-if="importPreview && !canApply"
        class="message danger"
      >
        导入存在错误，已保留当前清单行，请修正后重新预览。
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, ref, watch } from "vue";
import {
  addBillRow,
  applyBillExcelImport,
  deleteBillRow,
  downloadBillExcelTemplate,
  previewBillExcelImport,
  reorderBillRows,
  updateBillRow
} from "../../../api/contract-workbench.api";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";
import { centsTextToYuanText } from "../../../lib/money";
import {
  billColumns,
  billRowValidationMessage,
  canApplyImport,
  createUnsavedBillRow,
  importPreviewCounts,
  importPreviewErrors,
  importPreviewRows,
  inheritedTaxRateText,
  isUnlimitedFrameworkBill,
  isUnsavedBillRow,
  rowValue,
  updateRowPreservingKey,
  type WorkbenchBill,
  type WorkbenchBillRow
} from "./contract-bill-editor";

const props = defineProps<{
  bill: WorkbenchBill;
  disabled: boolean;
  prepareMutation?: () => Promise<unknown | null>;
  preparationError?: string;
  completeMutation?: (reload: boolean) => Promise<void>;
}>();

const emit = defineEmits<{
  (event: "reload"): void;
}>();

const localRows = ref<WorkbenchBillRow[]>([]);
const importFiles = ref<UploadFile[]>([]);
const busy = ref(false);
const message = ref("");
const messageDanger = ref(false);
const importPreview = ref<unknown>(null);
const previewVisible = ref(false);
const taxRateSourceOptions = [
  { label: "使用合同税率", value: "version_default" },
  { label: "使用例外税率", value: "row_override" }
];

const columns = computed(() => billColumns(props.bill));
const importCounts = computed(() => importPreviewCounts(importPreview.value));
const previewErrors = computed(() => importPreviewErrors(importPreview.value));
const previewRows = computed(() => importPreviewRows(importPreview.value));
const canApply = computed(() => Boolean(importId.value) && canApplyImport(importPreview.value));
const hasUnsavedRow = computed(() => localRows.value.some(isUnsavedBillRow));
const unlimitedFramework = computed(() => isUnlimitedFrameworkBill(props.bill));
const hasCalculatedRows = computed(() =>
  props.bill.rows.some((row) => row.taxInclusiveAmountCents !== null && row.taxInclusiveAmountCents !== undefined)
);
const totalText = computed(() =>
  hasCalculatedRows.value ? moneyText(props.bill.taxInclusiveAmountCents) : "—"
);
const importId = computed(() => {
  const value = importPreview.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return String(record["importId"] ?? record["id"] ?? "");
});

watch(
  () => props.bill,
  (bill) => {
    localRows.value = bill.rows.map((row) => ({
      ...row,
      taxRateSource: row.taxRateSource ?? "version_default",
      initialQuantity: row.quantity,
      initialUnitPrice: row.unitPrice,
      customData: { ...(row.customData ?? {}) }
    }));
    importFiles.value = [];
    importPreview.value = null;
    previewVisible.value = false;
    message.value = "";
    messageDanger.value = false;
  },
  { immediate: true }
);

function onCellValue(rowKey: string, key: string, value: string) {
  const coreKeys = new Set([
    "itemCode",
    "itemName",
    "specification",
    "unit",
    "quantity",
    "unitPrice",
    "taxRatePercent"
  ]);
  const current = localRows.value.find((row) => row.rowKey === rowKey);
  if (!current) {
    return;
  }
  const patch = coreKeys.has(key)
    ? { [key]: value }
    : { customData: { ...(current.customData ?? {}), [key]: value } };
  localRows.value = updateRowPreservingKey(localRows.value, rowKey, patch);
}

function onTaxSourceChange(rowKey: string, value: string) {
  const source = value === "row_override" ? "row_override" : "version_default";
  localRows.value = updateRowPreservingKey(localRows.value, rowKey, {
    taxRateSource: source,
    taxRatePercent: source === "version_default" ? props.bill.defaultTaxRatePercent ?? "" : ""
  });
}

function payload(row: WorkbenchBillRow) {
  const quantity = text(row, "quantity").trim();
  const source: "version_default" | "row_override" =
    props.bill.taxMode === "multiple_rate" && row.taxRateSource === "row_override"
      ? "row_override"
      : "version_default";
  const taxRatePercent =
    source === "row_override"
      ? text(row, "taxRatePercent").trim()
      : props.bill.defaultTaxRatePercent?.trim() ?? "";
  return {
    expectedBillRevision: props.bill.revision,
    itemCode: text(row, "itemCode"),
    itemName: text(row, "itemName").trim(),
    specification: text(row, "specification"),
    unit: text(row, "unit").trim(),
    ...(quantity ? { quantity } : {}),
    unitPrice: text(row, "unitPrice").trim(),
    taxRatePercent,
    taxRateSource: source,
    isProvisional: Boolean(row.isProvisional),
    settlementBasis: text(row, "settlementBasis"),
    customData: row.customData ?? {}
  };
}

function text(row: WorkbenchBillRow, key: string): string {
  return rowValue(row, key);
}

async function run(action: () => Promise<unknown>, success: string) {
  busy.value = true;
  message.value = "";
  messageDanger.value = false;
  try {
    await action();
    message.value = success;
    emit("reload");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "操作失败";
    messageDanger.value = true;
  } finally {
    busy.value = false;
  }
}

async function saveRow(row: WorkbenchBillRow) {
  const validationMessage = billRowValidationMessage(row, props.bill);
  if (validationMessage) {
    message.value = validationMessage;
    messageDanger.value = true;
    return;
  }
  await run(
    () =>
      isUnsavedBillRow(row)
        ? addBillRow(props.bill.id, payload(row))
        : updateBillRow(props.bill.id, row.rowKey, payload(row)),
    isUnsavedBillRow(row) ? "已新增并保存" : "已保存"
  );
}

function addEmptyRow() {
  const row = createUnsavedBillRow(
    `${Date.now()}-${localRows.value.length + 1}`,
    props.bill.defaultTaxRatePercent ?? ""
  );
  localRows.value = [...localRows.value, row];
  message.value = unlimitedFramework.value
    ? "已新增空白行；预计数量可不填，含税单价必须填写"
    : "已新增空白行，请填写后保存";
  messageDanger.value = false;
}

async function duplicateRow(row: WorkbenchBillRow) {
  const validationMessage = billRowValidationMessage(
    { ...row, precisionPolicy: "two_decimal" },
    props.bill
  );
  if (validationMessage) {
    message.value = validationMessage;
    messageDanger.value = true;
    return;
  }
  await run(() => addBillRow(props.bill.id, payload(row)), "已复制");
}

async function removeRow(row: WorkbenchBillRow) {
  if (isUnsavedBillRow(row)) {
    localRows.value = localRows.value.filter((item) => item.rowKey !== row.rowKey);
    message.value = "已取消新增";
    messageDanger.value = false;
    return;
  }
  await run(
    () => deleteBillRow(props.bill.id, row.rowKey, { expectedBillRevision: props.bill.revision }),
    "已删除"
  );
}

async function moveRow(rowKey: string, direction: -1 | 1) {
  const index = localRows.value.findIndex((row) => row.rowKey === rowKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= localRows.value.length) {
    return;
  }
  const rowKeys = localRows.value.map((row) => row.rowKey);
  [rowKeys[index], rowKeys[target]] = [rowKeys[target], rowKeys[index]];
  await run(
    () => reorderBillRows(props.bill.id, { expectedBillRevision: props.bill.revision, rowKeys }),
    "已排序"
  );
}

async function downloadTemplate() {
  await run(() => downloadBillExcelTemplate(props.bill.id), "模板已下载");
}

async function previewImport(files: UploadFile[]) {
  const raw = files[0]?.raw ?? importFiles.value[0]?.raw;
  const file = raw instanceof File ? raw : null;
  if (!file) {
    return;
  }
  busy.value = true;
  message.value = "";
  messageDanger.value = false;
  let prepared = false;
  try {
    if (props.prepareMutation) {
      const current = await props.prepareMutation();
      if (!current) {
        const detail = props.preparationError?.trim();
        throw new Error(detail
          ? `${detail}；本次未执行清单导入预览`
          : "合同草稿未保存，本次未执行清单导入预览");
      }
      prepared = true;
    }
    const uploaded = await uploadPrivateFile(file, file.name);
    importPreview.value = await previewBillExcelImport(props.bill.id, {
      fileId: uploaded.id,
      mode: "replace"
    });
    previewVisible.value = true;
    message.value = "预览完成";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "导入预览失败";
    messageDanger.value = true;
  } finally {
    if (prepared && props.completeMutation) await props.completeMutation(false);
    busy.value = false;
    importFiles.value = [];
  }
}

async function applyImport() {
  if (!importId.value || !canApply.value) {
    return;
  }
  previewVisible.value = false;
  await run(() => applyBillExcelImport(importId.value), "已应用导入");
}

function moneyText(value: string | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : `${centsTextToYuanText(value)} 元`;
}

function cellPlaceholder(key: string): string {
  if (key === "quantity" && unlimitedFramework.value) return "可不填";
  if (key === "unitPrice") return "最多 2 位小数";
  if (key === "quantity") return "最多 2 位小数";
  return "";
}

function previewRowText(row: Record<string, unknown>): string {
  return Object.entries(row)
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .join(" · ");
}
</script>

<style scoped>
.bill-editor {
  display: grid;
  gap: var(--jg-space-md);
  container-name: contract-bill;
  container-type: inline-size;
}

.toolbar,
.add-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.total {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.total strong {
  color: var(--jg-color-text-primary);
  font-variant-numeric: tabular-nums;
}

.total small {
  color: var(--jg-color-text-tertiary);
}

.actions,
.row-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--jg-space-xs);
}

.actions :deep(.t-upload) {
  max-width: 220px;
}

.preview-dialog {
  display: grid;
  gap: var(--jg-space-md);
}

.import-summary,
.message {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.preview-list {
  margin: 0;
  padding-left: var(--jg-space-lg-plus);
  font-size: var(--jg-font-size-meta);
}

.preview-rows {
  display: grid;
  max-height: 220px;
  overflow: auto;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-sm);
  background: var(--jg-color-bg-subtle);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-control);
  font-size: var(--jg-font-size-meta);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
}

.table-wrap {
  overflow-x: auto;
}

.bill-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  font-size: var(--jg-font-size-table-secondary);
}

.bill-table th,
.bill-table td {
  padding: var(--jg-space-sm);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  text-align: left;
  vertical-align: top;
}

.bill-table th {
  color: var(--jg-color-text-secondary);
  background: var(--jg-color-bg-subtle);
  font-weight: var(--jg-font-weight-semibold);
}

.bill-table tfoot td {
  color: var(--jg-color-text-primary);
  background: var(--jg-color-bg-subtle);
  font-weight: var(--jg-font-weight-bold);
}

.bill-table :deep(.t-input),
.bill-table :deep(.t-select) {
  min-width: 104px;
}

.tax-rate-cell {
  display: grid;
  min-width: 180px;
  gap: var(--jg-space-xs);
}

.inherited-rate {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  line-height: var(--jg-line-height-body);
}

.amount-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.danger {
  color: var(--jg-color-danger);
}

@container contract-bill (max-width: 520px) {
  .toolbar,
  .add-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

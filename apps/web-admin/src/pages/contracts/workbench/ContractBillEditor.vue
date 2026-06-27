<template>
  <div class="bill-editor">
    <div class="toolbar">
      <div class="total">
        <span>含税合计</span>
        <strong>{{ moneyText(bill.taxInclusiveAmountCents) }}</strong>
      </div>
      <div class="actions">
        <t-button
          size="small"
          variant="outline"
          @click="downloadTemplate"
        >
          下载模板
        </t-button>
        <label class="file-button">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            :disabled="disabled || busy"
            @change="previewImport"
          >
          导入预览
        </label>
        <t-button
          size="small"
          theme="primary"
          :disabled="disabled || busy || !canApply"
          @click="applyImport"
        >
          应用导入
        </t-button>
      </div>
    </div>

    <div
      v-if="importPreview"
      class="import-summary"
    >
      新增 {{ importCounts.added }} · 更新 {{ importCounts.updated }} · 移除
      {{ importCounts.removed }} · 跳过 {{ importCounts.skipped }} · 错误
      {{ importCounts.errors }}
    </div>

    <div class="table-wrap">
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
              <input
                :value="rowValue(row, column.key)"
                :disabled="disabled || busy"
                @input="onCellInput(row.rowKey, column.key, $event)"
              >
            </td>
            <td class="row-actions">
              <button
                type="button"
                :disabled="disabled || busy"
                @click="saveRow(row)"
              >
                保存
              </button>
              <button
                type="button"
                :disabled="disabled || busy"
                @click="duplicateRow(row)"
              >
                复制
              </button>
              <button
                type="button"
                :disabled="disabled || busy"
                @click="moveRow(row.rowKey, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                :disabled="disabled || busy"
                @click="moveRow(row.rowKey, 1)"
              >
                ↓
              </button>
              <button
                type="button"
                :disabled="disabled || busy"
                @click="removeRow(row)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td :colspan="Math.max(columns.length - 1, 1)">
              合计
            </td>
            <td>
              {{ moneyText(bill.taxInclusiveAmountCents) }}
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
        :disabled="disabled || busy"
        @click="addEmptyRow"
      >
        新增行
      </t-button>
      <span
        v-if="message"
        class="message"
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
import {
  billColumns,
  canApplyImport,
  importPreviewCounts,
  rowValue,
  updateRowPreservingKey,
  type WorkbenchBill,
  type WorkbenchBillRow
} from "./contract-bill-editor";

const props = defineProps<{
  bill: WorkbenchBill;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "reload"): void;
}>();

const localRows = ref<WorkbenchBillRow[]>([]);
const busy = ref(false);
const message = ref("");
const importPreview = ref<unknown>(null);

const columns = computed(() => billColumns(props.bill));
const importCounts = computed(() => importPreviewCounts(importPreview.value));
const canApply = computed(() => Boolean(importId.value) && canApplyImport(importPreview.value));
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
      customData: { ...(row.customData ?? {}) }
    }));
    importPreview.value = null;
    message.value = "";
  },
  { immediate: true }
);

function onCellInput(rowKey: string, key: string, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  const coreKeys = new Set(["itemCode", "itemName", "specification", "unit", "quantity", "unitPrice", "taxRatePercent"]);
  const current = localRows.value.find((row) => row.rowKey === rowKey);
  if (!current) {
    return;
  }
  const patch = coreKeys.has(key)
    ? { [key]: value }
    : { customData: { ...(current.customData ?? {}), [key]: value } };
  localRows.value = updateRowPreservingKey(localRows.value, rowKey, patch);
}

function payload(row: WorkbenchBillRow) {
  return {
    expectedBillRevision: props.bill.revision,
    itemCode: text(row, "itemCode"),
    itemName: text(row, "itemName") || "未命名",
    specification: text(row, "specification"),
    unit: text(row, "unit") || "项",
    quantity: text(row, "quantity") || "0",
    unitPrice: text(row, "unitPrice") || "0",
    taxRatePercent: text(row, "taxRatePercent") || text(row, "taxRate") || "0",
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
  try {
    await action();
    message.value = success;
    emit("reload");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    busy.value = false;
  }
}

async function saveRow(row: WorkbenchBillRow) {
  await run(() => updateBillRow(props.bill.id, row.rowKey, payload(row)), "已保存");
}

async function addEmptyRow() {
  await run(
    () =>
      addBillRow(props.bill.id, {
        expectedBillRevision: props.bill.revision,
        itemName: "未命名",
        unit: "项",
        quantity: "0",
        unitPrice: "0",
        taxRatePercent: "0",
        customData: {}
      }),
    "已新增"
  );
}

async function duplicateRow(row: WorkbenchBillRow) {
  await run(() => addBillRow(props.bill.id, payload(row)), "已复制");
}

async function removeRow(row: WorkbenchBillRow) {
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

async function previewImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) {
    return;
  }
  busy.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    importPreview.value = await previewBillExcelImport(props.bill.id, {
      fileId: uploaded.id,
      mode: "replace"
    });
    message.value = "预览完成";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "导入预览失败";
  } finally {
    busy.value = false;
    (event.target as HTMLInputElement).value = "";
  }
}

async function applyImport() {
  if (!importId.value || !canApply.value) {
    return;
  }
  await run(() => applyBillExcelImport(importId.value), "已应用导入");
}

function moneyText(value: string | number | undefined): string {
  const cents = Number(value ?? 0);
  return `${(cents / 100).toFixed(2)} 元`;
}
</script>

<style scoped>
.bill-editor {
  display: grid;
  gap: 12px;
}

.toolbar,
.add-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.total {
  display: flex;
  gap: 8px;
  color: #424955;
  font-size: 12px;
}

.actions,
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.file-button,
.row-actions button {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  color: #0052d9;
  background: #fff;
  border: 1px solid #b8c7e6;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
}

.file-button input {
  display: none;
}

.import-summary,
.message {
  color: #424955;
  font-size: 12px;
}

.table-wrap {
  overflow-x: auto;
}

.bill-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  font-size: 12px;
}

.bill-table th,
.bill-table td {
  padding: 8px;
  border: 1px solid #dce1e8;
  text-align: left;
}

.bill-table th {
  color: #424955;
  background: #f7f9fc;
  font-weight: 600;
}

.bill-table tfoot td {
  color: #151922;
  background: #f7f9fc;
  font-weight: 700;
}

.bill-table input {
  width: 100%;
  min-width: 80px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid #ccd4df;
  border-radius: 3px;
}

.danger {
  color: #b51d2a;
}
</style>

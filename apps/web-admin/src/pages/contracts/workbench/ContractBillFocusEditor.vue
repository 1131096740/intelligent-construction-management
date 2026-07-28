<script lang="ts">
import {
  computed,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from "vue";
import {
  applyBillExcelImport,
  downloadBillExcelTemplate,
  previewBillExcelImport,
  replaceContractBillRows,
  type ContractBillValidationError,
  type ReplaceContractBillRowsInput,
  type ReplaceContractBillRowsReadModel,
  type VersionBillExcelImportPreview
} from "../../../api/contract-workbench.api";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";
import {
  addBillCandidateRow,
  authoritativeBillTotals,
  copyBillCandidateRow,
  fromBatchSaveReadModel,
  fromWorkbenchBill,
  invalidateChangedAuthoritativePricing,
  mapServerBillCellErrors,
  moveBillCandidateRow,
  removeBillCandidateRow,
  toReplaceBillRowsInput,
  validateBillCandidateRows,
  type ContractBillCandidateRow,
  type ContractBillCellError
} from "./contract-bill-grid";
import type { WorkbenchBill } from "./contract-bill-editor";

interface UploadedFileReadModel {
  id: string;
}

interface FocusControllerDependencies {
  createKey: () => string;
  downloadTemplate: (billId: string) => Promise<void>;
  uploadFile: (file: Blob, fileName: string) => Promise<UploadedFileReadModel>;
  previewImport: (billId: string, body: { fileId: string; mode: "replace" | "version_replace" }) => Promise<unknown>;
  applyImport: (importId: string) => Promise<unknown>;
  replaceRows: (
    billId: string,
    input: ReplaceContractBillRowsInput
  ) => Promise<ReplaceContractBillRowsReadModel>;
}

export interface ContractBillFocusControllerOptions {
  bill: () => WorkbenchBill;
  disabled: () => boolean;
  ordinaryDraftDirty: () => boolean;
  emit: (
    event: "close" | "dirty-change" | "saved",
    value?: boolean | ReplaceContractBillRowsReadModel
  ) => void;
  deps?: Partial<FocusControllerDependencies>;
}

export interface ContractBillFocusController {
  billSnapshot: Ref<WorkbenchBill>;
  rows: Ref<ContractBillCandidateRow[]>;
  errors: Ref<ContractBillCellError[]>;
  saving: Ref<boolean>;
  batchSaving: Ref<boolean>;
  saveMessage: Ref<string>;
  messageDanger: Ref<boolean>;
  preview: Ref<BillImportPreview | null>;
  replaceConfirmVisible: Ref<boolean>;
  pendingImportRows: Ref<ContractBillCandidateRow[] | null>;
  versionPreview: Ref<VersionBillExcelImportPreview | null>;
  versionImportConfirmVisible: Ref<boolean>;
  selectedClientRowKey: Ref<string>;
  saveKey: Ref<string>;
  lastAttemptDigest: Ref<string | null>;
  dirty: ComputedRef<boolean>;
  totals: ComputedRef<ReturnType<typeof authoritativeBillTotals>>;
  replacePrompt: ComputedRef<string>;
  addRow: () => void;
  copySelectedRow: () => void;
  deleteSelectedRow: () => void;
  moveSelectedRow: (offset: -1 | 1) => void;
  setRows: (rows: ContractBillCandidateRow[]) => void;
  previewExcel: (file: File) => Promise<void>;
  previewVersionExcel: (file: File) => Promise<void>;
  cancelImportReplace: () => void;
  confirmImportReplace: () => void;
  cancelVersionImport: () => void;
  confirmVersionImport: () => Promise<void>;
  downloadTemplate: () => Promise<void>;
  saveAll: () => Promise<void>;
  discardChanges: () => boolean;
  syncBill: (bill: WorkbenchBill) => void;
}

interface BillImportPreview {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: Array<{ message: string }>;
  candidateRowsPresent: boolean;
  candidateRows: ContractBillCandidateRow[];
}

const ORDINARY_DRAFT_MESSAGE = "请先使用右上角保存当前合同基础信息";

export function createContractBillFocusController(
  options: ContractBillFocusControllerOptions
): ContractBillFocusController {
  const dependencies: FocusControllerDependencies = {
    createKey: defaultSaveKey,
    downloadTemplate: downloadBillExcelTemplate,
    uploadFile: uploadPrivateFile,
    previewImport: previewBillExcelImport,
    applyImport: applyBillExcelImport,
    replaceRows: replaceContractBillRows,
    ...options.deps
  };
  const billSnapshot = ref(cloneBill(options.bill()));
  const rows = ref(fromWorkbenchBill(billSnapshot.value));
  const baselineRows = ref(cloneRows(rows.value));
  const baselineDigest = ref(candidateDigest(rows.value));
  const errors = ref<ContractBillCellError[]>([]);
  const saving = ref(false);
  const batchSaving = ref(false);
  const saveMessage = ref("");
  const messageDanger = ref(false);
  const preview = ref<BillImportPreview | null>(null);
  const replaceConfirmVisible = ref(false);
  const pendingImportRows = ref<ContractBillCandidateRow[] | null>(null);
  const versionPreview = ref<VersionBillExcelImportPreview | null>(null);
  const versionImportConfirmVisible = ref(false);
  const selectedClientRowKey = ref(rows.value[0]?.clientRowKey ?? "");
  const saveKey = ref(dependencies.createKey());
  const lastAttemptDigest = ref<string | null>(null);
  const dirty = computed(() => candidateDigest(rows.value) !== baselineDigest.value);
  const totals = computed(() => authoritativeBillTotals(billSnapshot.value));
  const replacePrompt = computed(
    () => `将替换当前 ${rows.value.length} 行未保存清单，确认后仍需点击“保存全部”才会写入系统。`
  );

  watch(
    dirty,
    (value) => options.emit("dirty-change", value),
    { immediate: true, flush: "sync" }
  );

  function addRow() {
    if (options.disabled()) return;
    replaceCandidateRows(addBillCandidateRow(rows.value));
    selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
    clearTransientErrors();
  }

  function copySelectedRow() {
    if (options.disabled()) return;
    const beforeLength = rows.value.length;
    replaceCandidateRows(copyBillCandidateRow(rows.value, selectedClientRowKey.value));
    if (rows.value.length > beforeLength) {
      selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
    }
    clearTransientErrors();
  }

  function deleteSelectedRow() {
    if (options.disabled()) return;
    replaceCandidateRows(removeBillCandidateRow(rows.value, selectedClientRowKey.value));
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    clearTransientErrors();
  }

  function moveSelectedRow(offset: -1 | 1) {
    if (options.disabled()) return;
    replaceCandidateRows(
      moveBillCandidateRow(rows.value, selectedClientRowKey.value, offset)
    );
    clearTransientErrors();
  }

  function setRows(nextRows: ContractBillCandidateRow[]) {
    if (options.disabled()) return;
    replaceCandidateRows(
      invalidateChangedAuthoritativePricing(rows.value, nextRows)
    );
    clearTransientErrors();
  }

  async function previewExcel(file: File) {
    clearMessage();
    if (options.ordinaryDraftDirty()) {
      setError(ORDINARY_DRAFT_MESSAGE);
      return;
    }
    if (!isXlsxFile(file)) {
      setError("仅支持上传 .xlsx 格式的系统标准模板");
      return;
    }
    saving.value = true;
    try {
      const uploaded = await dependencies.uploadFile(file, file.name);
      const result = normalizeImportPreview(
        await dependencies.previewImport(billSnapshot.value.id, {
          fileId: uploaded.id,
          mode: "replace"
        })
      );
      preview.value = result;
      if (result.errors.length || !result.candidateRowsPresent) {
        pendingImportRows.value = null;
        replaceConfirmVisible.value = false;
        setError(
          result.errors.map((error) => error.message).join("；") ||
          "Excel 中没有可载入的清单行"
        );
        return;
      }
      pendingImportRows.value = cloneRows(result.candidateRows);
      replaceConfirmVisible.value = true;
      saveMessage.value = "预检完成，请确认是否替换当前本地候选";
    } catch (error) {
      setError(errorMessage(error, "导入预检失败"));
    } finally {
      saving.value = false;
    }
  }

  async function previewVersionExcel(file: File) {
    clearMessage();
    if (options.ordinaryDraftDirty()) {
      setError(ORDINARY_DRAFT_MESSAGE);
      return;
    }
    if (!isXlsxFile(file)) {
      setError("仅支持上传 .xlsx 格式的系统标准模板");
      return;
    }
    saving.value = true;
    try {
      const uploaded = await dependencies.uploadFile(file, file.name);
      const result = normalizeVersionImportPreview(
        await dependencies.previewImport(billSnapshot.value.id, {
          fileId: uploaded.id,
          mode: "version_replace"
        })
      );
      versionPreview.value = result;
      if (result.errors.length) {
        versionImportConfirmVisible.value = false;
        setError(result.errors.map((error) => error.message).join("；"));
        return;
      }
      versionImportConfirmVisible.value = true;
      saveMessage.value = "新版清单预检完成，请核对差异后确认应用";
    } catch (error) {
      setError(errorMessage(error, "导入新版清单预检失败"));
    } finally {
      saving.value = false;
    }
  }

  function cancelImportReplace() {
    replaceConfirmVisible.value = false;
    pendingImportRows.value = null;
    saveMessage.value = "已取消替换，手工填写内容保持不变";
    messageDanger.value = false;
  }

  function confirmImportReplace() {
    if (!pendingImportRows.value) return;
    replaceCandidateRows(pendingImportRows.value);
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    errors.value = [];
    pendingImportRows.value = null;
    replaceConfirmVisible.value = false;
    saveMessage.value = "Excel 预检结果已载入本地，点击“保存全部”后才会写入系统";
    messageDanger.value = false;
  }

  function cancelVersionImport() {
    versionImportConfirmVisible.value = false;
    versionPreview.value = null;
    saveMessage.value = "已取消导入新版清单，当前清单保持不变";
    messageDanger.value = false;
  }

  async function confirmVersionImport() {
    const importId = versionPreview.value?.importId;
    if (!importId || options.disabled()) return;
    clearMessage();
    saving.value = true;
    batchSaving.value = true;
    try {
      await dependencies.applyImport(importId);
      // 新版清单已在服务端原子应用；放弃仅存在于本地的候选，才能接收随后
      // 刷新的权威清单，避免 syncBill 因 dirty 而拒绝回读。
      replaceCandidateRows(baselineRows.value);
      selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
      errors.value = [];
      versionImportConfirmVisible.value = false;
      versionPreview.value = null;
      saveMessage.value = "新版清单已原子应用，正在刷新合同工作台";
      messageDanger.value = false;
      options.emit("saved");
    } catch (error) {
      setError(errorMessage(error, "应用新版清单失败"));
    } finally {
      batchSaving.value = false;
      saving.value = false;
    }
  }

  async function downloadTemplate() {
    clearMessage();
    saving.value = true;
    try {
      await dependencies.downloadTemplate(billSnapshot.value.id);
      saveMessage.value = "标准模板已下载";
    } catch (error) {
      setError(errorMessage(error, "下载标准模板失败"));
    } finally {
      saving.value = false;
    }
  }

  async function saveAll() {
    clearMessage();
    if (options.disabled()) return;
    if (options.ordinaryDraftDirty()) {
      setError(ORDINARY_DRAFT_MESSAGE);
      return;
    }
    const localErrors = validateBillCandidateRows(rows.value, billSnapshot.value);
    if (localErrors.length) {
      errors.value = localErrors;
      setError(`清单有 ${localErrors.length} 处需要修正`);
      return;
    }
    saving.value = true;
    const attemptDigest = candidateDigest(rows.value);
    if (
      lastAttemptDigest.value !== null &&
      lastAttemptDigest.value !== attemptDigest
    ) {
      rotateSaveAttempt();
    }
    lastAttemptDigest.value = attemptDigest;
    const attemptKey = saveKey.value;
    try {
      batchSaving.value = true;
      const saved = await dependencies.replaceRows(
        billSnapshot.value.id,
        toReplaceBillRowsInput(rows.value, {
          expectedBillRevision: billSnapshot.value.revision,
          idempotencyKey: attemptKey,
          taxMode: billSnapshot.value.taxMode,
          defaultTaxRatePercent: billSnapshot.value.defaultTaxRatePercent
        })
      );
      rows.value = fromBatchSaveReadModel(saved);
      baselineRows.value = cloneRows(rows.value);
      baselineDigest.value = candidateDigest(rows.value);
      billSnapshot.value = billSnapshotFromBatchSave(billSnapshot.value, saved);
      rotateSaveAttempt();
      errors.value = [];
      saveMessage.value = "清单已全部保存";
      messageDanger.value = false;
      options.emit("dirty-change", false);
      options.emit("saved", saved);
    } catch (error) {
      if (isContractBillValidationError(error)) {
        errors.value = mapServerBillCellErrors(error.rowErrors);
      }
      setError(errorMessage(error, "保存清单失败"));
    } finally {
      batchSaving.value = false;
      saving.value = false;
    }
  }

  function discardChanges() {
    if (batchSaving.value) return false;
    replaceCandidateRows(baselineRows.value);
    errors.value = [];
    pendingImportRows.value = null;
    replaceConfirmVisible.value = false;
    versionPreview.value = null;
    versionImportConfirmVisible.value = false;
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    saveMessage.value = "";
    messageDanger.value = false;
    return true;
  }

  function syncBill(nextBill: WorkbenchBill) {
    if (dirty.value) return;
    if (
      nextBill.id === billSnapshot.value.id &&
      nextBill.revision < billSnapshot.value.revision
    ) {
      return;
    }
    const nextSnapshot = cloneBill(nextBill);
    const nextRows = fromWorkbenchBill(nextSnapshot);
    const changed =
      nextSnapshot.id !== billSnapshot.value.id ||
      nextSnapshot.revision !== billSnapshot.value.revision ||
      candidateDigest(nextRows) !== baselineDigest.value;
    billSnapshot.value = nextSnapshot;
    rows.value = cloneRows(nextRows);
    baselineRows.value = cloneRows(nextRows);
    baselineDigest.value = candidateDigest(nextRows);
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    errors.value = [];
    pendingImportRows.value = null;
    replaceConfirmVisible.value = false;
    if (changed || lastAttemptDigest.value !== null) {
      rotateSaveAttempt();
    }
  }

  function replaceCandidateRows(nextRows: readonly ContractBillCandidateRow[]) {
    const previousDigest = candidateDigest(rows.value);
    const cloned = cloneRows(nextRows);
    const nextDigest = candidateDigest(cloned);
    rows.value = cloned;
    if (
      previousDigest !== nextDigest &&
      lastAttemptDigest.value !== null &&
      nextDigest !== lastAttemptDigest.value
    ) {
      rotateSaveAttempt();
    }
  }

  function rotateSaveAttempt() {
    saveKey.value = dependencies.createKey();
    lastAttemptDigest.value = null;
  }

  function clearTransientErrors() {
    errors.value = [];
    clearMessage();
  }

  function clearMessage() {
    saveMessage.value = "";
    messageDanger.value = false;
  }

  function setError(message: string) {
    saveMessage.value = message;
    messageDanger.value = true;
  }

  return {
    billSnapshot,
    rows,
    errors,
    saving,
    batchSaving,
    saveMessage,
    messageDanger,
    preview,
    replaceConfirmVisible,
    pendingImportRows,
    versionPreview,
    versionImportConfirmVisible,
    selectedClientRowKey,
    saveKey,
    lastAttemptDigest,
    dirty,
    totals,
    replacePrompt,
    addRow,
    copySelectedRow,
    deleteSelectedRow,
    moveSelectedRow,
    setRows,
    previewExcel,
    previewVersionExcel,
    cancelImportReplace,
    confirmImportReplace,
    cancelVersionImport,
    confirmVersionImport,
    downloadTemplate,
    saveAll,
    discardChanges,
    syncBill
  };
}

function defaultSaveKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `bill-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneRows(rows: readonly ContractBillCandidateRow[]) {
  return rows.map((row) => ({
    ...row,
    customData: { ...row.customData }
  }));
}

function cloneBill(bill: WorkbenchBill): WorkbenchBill {
  return {
    ...bill,
    schemaSnapshot: bill.schemaSnapshot
      ? { ...bill.schemaSnapshot }
      : bill.schemaSnapshot,
    rows: bill.rows.map((row) => ({
      ...row,
      customData: { ...(row.customData ?? {}) }
    }))
  };
}

function billSnapshotFromBatchSave(
  current: WorkbenchBill,
  saved: ReplaceContractBillRowsReadModel
): WorkbenchBill {
  const savedBill = saved.bill;
  return {
    ...current,
    ...(savedBill ?? {}),
    revision: savedBill?.revision ?? current.revision,
    rows: saved.rows.map((row) => ({
      rowKey: row.rowKey,
      itemCode: row.itemCode,
      itemName: row.itemName,
      specification: row.specification,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      taxRate: row.taxRate,
      taxRatePercent: row.taxRate,
      taxRateSource: row.taxRateSource === "row_override"
        ? "row_override"
        : "version_default",
      pricingFactStatus: row.pricingFactStatus,
      precisionPolicy: row.precisionPolicy,
      initialQuantity: row.quantity,
      initialUnitPrice: row.unitPrice,
      taxInclusiveAmountCents: row.taxInclusiveAmountCents,
      taxExclusiveAmountCents: row.taxExclusiveAmountCents,
      taxAmountCents: row.taxAmountCents,
      taxExclusiveUnitPrice: row.taxExclusiveUnitPrice,
      settlementBasis: row.settlementBasis,
      isProvisional: row.isProvisional,
      customData: { ...row.customData }
    }))
  };
}

function candidateDigest(rows: readonly ContractBillCandidateRow[]) {
  return JSON.stringify(rows);
}

function isXlsxFile(file: File) {
  return file.name.trim().toLowerCase().endsWith(".xlsx");
}

function isContractBillValidationError(
  error: unknown
): error is ContractBillValidationError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<ContractBillValidationError>;
  return candidate.code === "CONTRACT_BILL_VALIDATION_FAILED" &&
    Array.isArray(candidate.rowErrors);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function normalizeVersionImportPreview(value: unknown): VersionBillExcelImportPreview {
  const source = record(value);
  const importId = requiredText(source["importId"]);
  if (!importId) throw new Error("新版清单预检未返回有效导入标识，请重新上传");
  const errors = Array.isArray(source["errors"])
    ? source["errors"].map(importError).filter((error): error is { message: string } => Boolean(error))
    : [];
  const diffs = Array.isArray(source["diffs"])
    ? source["diffs"].filter(isVersionImportDiff)
    : [];
  return {
    importId,
    added: count(source["added"]),
    updated: count(source["updated"]),
    removed: count(source["removed"]),
    skipped: count(source["skipped"]),
    beforeAmountCents: text(source["beforeAmountCents"]),
    afterAmountCents: text(source["afterAmountCents"]),
    errors,
    diffs
  };
}

function isVersionImportDiff(value: unknown): value is VersionBillExcelImportPreview["diffs"][number] {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  return typeof value["rowKey"] === "string" &&
    (kind === "unchanged" || kind === "added" || kind === "removed" ||
      kind === "one_to_one" || kind === "manual_review");
}

function normalizeImportPreview(value: unknown): BillImportPreview {
  const source = record(value);
  const rawCandidateRows = source["candidateRows"];
  const candidateRowsPresent = Array.isArray(rawCandidateRows);
  const parsedCandidateRows: ContractBillCandidateRow[] = [];
  const candidateErrors: Array<{ message: string }> = [];
  if (candidateRowsPresent) {
    rawCandidateRows.forEach((candidate, index) => {
      const parsed = importCandidateRow(candidate);
      if (parsed) {
        parsedCandidateRows.push(parsed);
      } else {
        candidateErrors.push({
          message: `Excel 预检返回的第 ${index + 1} 行数据不完整，请重新导入`
        });
      }
    });
  }
  return {
    added: count(source["added"]),
    updated: count(source["updated"]),
    removed: count(source["removed"]),
    skipped: count(source["skipped"]),
    errors: (Array.isArray(source["errors"])
      ? source["errors"].map(importError).filter((error): error is { message: string } => Boolean(error))
      : []).concat(candidateErrors),
    candidateRowsPresent,
    candidateRows: candidateErrors.length ? [] : parsedCandidateRows
  };
}

function importCandidateRow(value: unknown): ContractBillCandidateRow | null {
  if (!isRecord(value)) return null;
  const source = value;
  const clientRowKey = requiredText(source["clientRowKey"]);
  const itemName = requiredText(source["itemName"]);
  const unit = requiredText(source["unit"]);
  const unitPrice = requiredText(source["unitPrice"]);
  if (!clientRowKey || !itemName || !unit || !unitPrice) return null;
  if (
    !Number.isInteger(source["sortOrder"]) ||
    (source["sortOrder"] as number) < 0 ||
    (source["taxRateSource"] !== "row_override" &&
      source["taxRateSource"] !== "version_default") ||
    typeof source["isProvisional"] !== "boolean"
  ) {
    return null;
  }
  const optionalTextFields = [
    "rowKey",
    "itemCode",
    "specification",
    "quantity",
    "taxRatePercent",
    "settlementBasis"
  ];
  if (optionalTextFields.some((key) => !isOptionalText(source[key]))) {
    return null;
  }
  if (
    !isRecord(source["customData"]) ||
    Object.values(source["customData"]).some((item) => typeof item !== "string")
  ) {
    return null;
  }
  const taxRateSource = source["taxRateSource"];
  const customData = Object.fromEntries(
    Object.entries(source["customData"]).map(([key, item]) => [key, item as string])
  );
  return {
    clientRowKey,
    ...(text(source["rowKey"]) ? { rowKey: text(source["rowKey"]) } : {}),
    itemCode: text(source["itemCode"]),
    itemName,
    specification: text(source["specification"]),
    unit,
    quantity: text(source["quantity"]),
    unitPrice,
    taxRatePercent: text(source["taxRatePercent"]),
    taxRateSource,
    isProvisional: source["isProvisional"],
    settlementBasis: text(source["settlementBasis"]),
    customData
  };
}

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function isOptionalText(value: unknown) {
  return value === null || value === undefined || typeof value === "string";
}

function importError(value: unknown) {
  const source = record(value);
  const message = text(source["message"]);
  return message ? { message } : null;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value)
    ? value as Record<string, unknown>
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function count(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
</script>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { centsTextToYuanText } from "../../../lib/money";
import ContractBillGrid from "./ContractBillGrid.vue";

const props = defineProps<{
  bill: WorkbenchBill;
  disabled: boolean;
  ordinaryDraftDirty: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [readModel: ReplaceContractBillRowsReadModel];
  "dirty-change": [dirty: boolean];
  "batch-saving-change": [saving: boolean];
}>();

const importFiles = ref<UploadFile[]>([]);
const uploadRef = ref<{ $el?: HTMLElement } | null>(null);
const controller = createContractBillFocusController({
  bill: () => props.bill,
  disabled: () => props.disabled,
  ordinaryDraftDirty: () => props.ordinaryDraftDirty,
  emit: (event, value) => {
    if (event === "close") emit("close");
    if (event === "dirty-change") emit("dirty-change", Boolean(value));
    if (event === "saved") emit("saved", value as ReplaceContractBillRowsReadModel);
  }
});

const {
  billSnapshot,
  rows,
  errors,
  saving,
  batchSaving,
  saveMessage,
  messageDanger,
  preview,
  replaceConfirmVisible,
  versionPreview,
  versionImportConfirmVisible,
  selectedClientRowKey,
  dirty,
  totals,
  replacePrompt
} = controller;

const statusText = computed(() => dirty.value ? "有待保存修改" : "清单已保存");
const totalsText = computed(() => totals.value.kind === "authoritative"
  ? {
      exclusive: moneyText(totals.value.taxExclusiveAmountCents),
      tax: moneyText(totals.value.taxAmountCents),
      inclusive: moneyText(totals.value.taxInclusiveAmountCents)
    }
  : { exclusive: "—", tax: "—", inclusive: "—" }
);

watch(
  () => props.bill,
  (bill) => controller.syncBill(bill),
  { deep: true }
);

watch(
  batchSaving,
  (value) => emit("batch-saving-change", value),
  { immediate: true, flush: "sync" }
);

function openImportPicker() {
  if (props.disabled || saving.value) return;
  const input = uploadRef.value?.$el?.querySelector<HTMLInputElement>('input[type="file"]');
  input?.click();
}

function requestClose() {
  if (batchSaving.value) return;
  emit("close");
}

async function onFileSelected(files: UploadFile[]) {
  const raw = files[0]?.raw ?? importFiles.value[0]?.raw;
  const file = raw instanceof File ? raw : null;
  importFiles.value = [];
  if (file) await controller.previewVersionExcel(file);
}

function moneyText(value: string) {
  return `${centsTextToYuanText(value)} 元`;
}

defineExpose({
  discardChanges: controller.discardChanges,
  openImportPicker
});
</script>

<template>
  <section class="bill-focus-editor">
    <header class="focus-head">
      <div>
        <t-button
          variant="text"
          data-testid="bill-focus-close"
          :disabled="batchSaving"
          @click="requestClose"
        >
          返回合同
        </t-button>
        <h2>{{ billSnapshot.name }}</h2>
        <span :class="['save-status', { dirty }]">{{ statusText }}</span>
      </div>
      <t-button
        theme="primary"
        data-testid="bill-save-all"
        :disabled="disabled || saving"
        :loading="saving"
        @click="controller.saveAll"
      >
        保存全部
      </t-button>
    </header>

    <div class="focus-toolbar">
      <t-button
        data-testid="bill-add-row"
        :disabled="disabled || saving"
        @click="controller.addRow"
      >
        新增行
      </t-button>
      <t-button
        data-testid="bill-copy-row"
        :disabled="disabled || saving || !selectedClientRowKey"
        @click="controller.copySelectedRow"
      >
        复制行
      </t-button>
      <t-button
        data-testid="bill-delete-row"
        :disabled="disabled || saving || !selectedClientRowKey"
        @click="controller.deleteSelectedRow"
      >
        删除行
      </t-button>
      <t-button
        data-testid="bill-move-up"
        :disabled="disabled || saving || !selectedClientRowKey"
        @click="controller.moveSelectedRow(-1)"
      >
        上移
      </t-button>
      <t-button
        data-testid="bill-move-down"
        :disabled="disabled || saving || !selectedClientRowKey"
        @click="controller.moveSelectedRow(1)"
      >
        下移
      </t-button>
      <t-button
        variant="outline"
        :disabled="disabled || saving"
        @click="controller.downloadTemplate"
      >
        下载标准模板
      </t-button>
      <t-upload
        ref="uploadRef"
        v-model="importFiles"
        theme="file-input"
        data-testid="bill-import-input"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        :auto-upload="false"
        :max="1"
        :disabled="disabled || saving"
        :loading="saving"
        placeholder="导入新版清单"
        @change="onFileSelected"
      />
    </div>

    <t-alert
      v-if="saveMessage"
      :theme="messageDanger ? 'error' : 'success'"
      :message="saveMessage"
    />

    <div
      v-if="errors.length"
      class="error-summary"
    >
      <strong>{{ errors.length }} 处需要修正</strong>
      <span>{{ errors[0]?.message }}</span>
    </div>

    <ContractBillGrid
      data-testid="contract-bill-grid"
      :bill="billSnapshot"
      :rows="rows"
      :errors="errors"
      :readonly="disabled || saving"
      @update:rows="controller.setRows"
      @select-row="selectedClientRowKey = $event"
    />

    <footer class="focus-summary">
      <span>候选行数 <strong>{{ rows.length }}</strong></span>
      <span>已保存不含税合计 <strong>{{ totalsText.exclusive }}</strong></span>
      <span>已保存税额 <strong>{{ totalsText.tax }}</strong></span>
      <span>已保存含税合计 <strong>{{ totalsText.inclusive }}</strong></span>
    </footer>

    <t-dialog
      v-model:visible="replaceConfirmVisible"
      header="确认替换本地清单"
      width="560px"
      :close-on-overlay-click="false"
      @close="controller.cancelImportReplace"
    >
      <p>{{ replacePrompt }}</p>
      <p v-if="preview">
        预检：新增 {{ preview.added }} 行，移除 {{ preview.removed }} 行。
      </p>
      <template #footer>
        <t-button
          variant="outline"
          data-testid="bill-import-cancel"
          @click="controller.cancelImportReplace"
        >
          取消，保留手工填写
        </t-button>
        <t-button
          theme="primary"
          data-testid="bill-import-confirm"
          @click="controller.confirmImportReplace"
        >
          确认载入本地
        </t-button>
      </template>
    </t-dialog>

    <t-dialog
      v-model:visible="versionImportConfirmVisible"
      header="确认应用新版清单"
      width="620px"
      :close-on-overlay-click="false"
      @close="controller.cancelVersionImport"
    >
      <p>本次应用会原子更新合同清单；任一来源、文件或占用事实变化都会整体失败。</p>
      <p v-if="dirty">
        当前未保存的本地清单候选不会写入系统；确认应用后会以新版清单的权威结果刷新。
      </p>
      <p v-if="versionPreview">
        未变化 {{ versionPreview.diffs.filter((item) => item.kind === 'unchanged').length }} 行，
        已修改 {{ versionPreview.diffs.filter((item) => item.kind === 'one_to_one').length }} 行，
        新增 {{ versionPreview.added }} 行，删除 {{ versionPreview.removed }} 行。
      </p>
      <template #footer>
        <t-button
          variant="outline"
          @click="controller.cancelVersionImport"
        >
          取消
        </t-button>
        <t-button
          theme="primary"
          data-testid="bill-version-import-confirm"
          :loading="batchSaving"
          @click="controller.confirmVersionImport"
        >
          确认应用
        </t-button>
      </template>
    </t-dialog>
  </section>
</template>

<style scoped>
.bill-focus-editor {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-md);
}

.focus-head,
.focus-toolbar,
.focus-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.focus-head {
  justify-content: space-between;
}

.focus-head > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.focus-head h2 {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-title);
}

.save-status {
  color: var(--jg-color-success);
  font-size: var(--jg-font-size-meta);
}

.save-status.dirty {
  color: var(--jg-color-warning);
}

.focus-toolbar {
  padding: var(--jg-space-sm);
  background: var(--jg-color-bg-subtle);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-card);
}

.focus-summary {
  position: sticky;
  bottom: 0;
  justify-content: flex-end;
  padding: var(--jg-space-md);
  background: var(--jg-color-bg-container);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
  font-variant-numeric: tabular-nums;
}

.focus-summary strong {
  color: var(--jg-color-text-primary);
}

.error-summary {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
  color: var(--jg-color-danger);
  font-size: var(--jg-font-size-meta);
}

</style>

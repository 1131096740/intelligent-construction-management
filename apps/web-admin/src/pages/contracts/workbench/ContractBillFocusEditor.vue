<script lang="ts">
import {
  computed,
  ref,
  type ComputedRef,
  type Ref
} from "vue";
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import {
  downloadContractDraftBillExcelTemplate,
  fetchContractDraftOperationCapabilities,
  previewContractDraftBillExcelImport,
  uploadContractWorkbenchPrivateFile,
  type ContractDraftBillExcelImportPreview
} from "../../../api/contract-workbench.api";
import {
  addBillCandidateRow,
  authoritativeBillTotals,
  previewBillGross,
  copyBillCandidateRow,
  fromWorkbenchBill,
  invalidateChangedAuthoritativePricing,
  moveBillCandidateRow,
  preservesGovernedBillRowKeys,
  removeBillCandidateRow,
  rowHasRemainderCancellationCapability,
  validateBillCandidateRows,
  type ContractBillCandidateRow,
  type ContractBillCellError
} from "./contract-bill-grid";
import type { WorkbenchBill } from "./contract-bill-editor";
import { formatUnknownApiError } from "../../../api/error-message";

async function uploadContractBillImportFileWithCapability(
  contractVersionId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("清单导入能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_workbench_private_file"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能上传合同清单文件");
  }
  return uploadContractWorkbenchPrivateFile(contractVersionId, file, fileName, idempotencyKey);
}

async function previewContractDraftBillExcelImportWithCapability(
  contractVersionId: string,
  billKey: string,
  body: { fileId: string; mode?: "append" | "replace" }
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("清单导入能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "preview_contract_draft_bill_excel_import"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能预检合同清单 Excel");
  }
  return previewContractDraftBillExcelImport(contractVersionId, billKey, body);
}

export interface ContractBillRemainderCancellationRequest {
  billId: string;
  billKey: string;
  rowKey: string;
  reason: string;
}

export type ContractBillRemainderCancellationExecutionResult =
  | { status: "completed" }
  | { status: "submitted_refresh_failed"; message: string };

interface SelectedRowRemainderCancellationCapability {
  availableActions: DetailActionReadModel[];
  action: DetailActionReadModel;
  facts: NonNullable<ContractBillCandidateRow["remainderCancellation"]>;
}

interface UploadedFileReadModel {
  id: string;
}

interface FocusControllerDependencies {
  downloadTemplate: (
    contractVersionId: string,
    billKey: string
  ) => Promise<void>;
  uploadFile: (
    contractVersionId: string,
    file: Blob,
    fileName: string,
    idempotencyKey?: string
  ) => Promise<UploadedFileReadModel>;
  previewImport: (
    contractVersionId: string,
    billKey: string,
    body: { fileId: string; mode?: "append" | "replace" }
  ) => Promise<ContractDraftBillExcelImportPreview>;
}

export interface ContractBillFocusControllerOptions {
  bill: () => WorkbenchBill;
  contractVersionId: () => string;
  disabled: () => boolean;
  emit: (
    event: "close" | "update:rows" | "edited",
    value?: ContractBillCandidateRow[]
  ) => void;
  executeRemainderCancellation?: (
    request: ContractBillRemainderCancellationRequest
  ) => Promise<ContractBillRemainderCancellationExecutionResult | void>;
  deps?: Partial<FocusControllerDependencies>;
}

export interface ContractBillFocusController {
  billSnapshot: Ref<WorkbenchBill>;
  rows: Ref<ContractBillCandidateRow[]>;
  errors: Ref<ContractBillCellError[]>;
  busy: Ref<boolean>;
  message: Ref<string>;
  messageDanger: Ref<boolean>;
  preview: Ref<BillImportPreview | null>;
  importMode: Ref<"append" | "replace">;
  importUndoAvailable: ComputedRef<boolean>;
  undoImport: () => void;
  replaceConfirmVisible: Ref<boolean>;
  pendingImportRows: Ref<ContractBillCandidateRow[] | null>;
  selectedClientRowKey: Ref<string>;
  selectedRowCapability: ComputedRef<SelectedRowRemainderCancellationCapability | null>;
  selectedRowHasRemainderCancellationCapability: ComputedRef<boolean>;
  remainderCancellationVisible: Ref<boolean>;
  remainderCancellationBusy: Ref<boolean>;
  remainderCancellationError: Ref<string>;
  remainderCancellationRetryLocked: ComputedRef<boolean>;
  totals: ComputedRef<ReturnType<typeof authoritativeBillTotals>>;
  replacePrompt: ComputedRef<string>;
  addRow: () => void;
  copySelectedRow: () => void;
  deleteSelectedRow: () => void;
  openRemainderCancellation: () => void;
  confirmRemainderCancellation: (
    values: { reason: string; password: string }
  ) => Promise<void>;
  moveSelectedRow: (offset: -1 | 1) => void;
  setRows: (rows: ContractBillCandidateRow[]) => void;
  previewExcel: (file: File) => Promise<void>;
  cancelImportReplace: () => void;
  cancelImportFile: () => void;
  confirmImportReplace: () => void;
  downloadTemplate: () => Promise<void>;
  syncBill: (bill: WorkbenchBill) => void;
}

interface BillImportPreview {
  billKey: string;
  targetBillRevision: number;
  added: number;
  skipped: number;
  errors: Array<{ message: string; sheet?: string; row?: number; column?: string }>;
  sourceColumns: NonNullable<ContractDraftBillExcelImportPreview["sourceColumns"]>;
  sourceRows: NonNullable<ContractDraftBillExcelImportPreview["sourceRows"]>;
  candidateRows: ContractBillCandidateRow[];
}

export function createContractBillFocusController(
  options: ContractBillFocusControllerOptions
): ContractBillFocusController {
  const dependencies: FocusControllerDependencies = {
    downloadTemplate: downloadContractDraftBillExcelTemplate,
    uploadFile: uploadContractBillImportFileWithCapability,
    previewImport: previewContractDraftBillExcelImportWithCapability,
    ...options.deps
  };
  const billSnapshot = ref(cloneBill(options.bill()));
  const rows = ref(fromWorkbenchBill(billSnapshot.value));
  const errors = ref<ContractBillCellError[]>([]);
  const busy = ref(false);
  const message = ref("");
  const messageDanger = ref(false);
  const preview = ref<BillImportPreview | null>(null);
  const importMode = ref<"append" | "replace">("append");
  let importUpload: { file: File; versionId: string; billKey: string; requestKey: string; id?: string } | null = null;
  const lastImport = ref<{ before: ContractBillCandidateRow[]; importedKeys: string[] } | null>(null);
  const importUndoAvailable = computed(() => lastImport.value !== null);
  const replaceConfirmVisible = ref(false);
  const pendingImportRows = ref<ContractBillCandidateRow[] | null>(null);
  const selectedClientRowKey = ref(rows.value[0]?.clientRowKey ?? "");
  const selectedRowCapability = computed(() =>
    remainderCancellationCapability(
      rows.value.find(
        (row) => row.clientRowKey === selectedClientRowKey.value
      )
    )
  );
  const selectedRowHasRemainderCancellationCapability = computed(() => {
    const selected = rows.value.find(
      (row) => row.clientRowKey === selectedClientRowKey.value
    );
    return selected ? rowHasRemainderCancellationCapability(selected) : false;
  });
  const remainderCancellationVisible = ref(false);
  const remainderCancellationBusy = ref(false);
  const remainderCancellationError = ref("");
  const remainderCancellationRetryLock = ref<{
    billId: string;
    billKey: string;
    rowKey: string;
    message: string;
  } | null>(null);
  const remainderCancellationRetryLocked = computed(() => {
    const locked = remainderCancellationRetryLock.value;
    const selected = rows.value.find(
      (row) => row.clientRowKey === selectedClientRowKey.value
    );
    return Boolean(
      locked &&
      selected?.rowKey === locked.rowKey &&
      billSnapshot.value.id === locked.billId &&
      billSnapshot.value.billKey === locked.billKey
    );
  });
  let remainderCancellationDialogGeneration = 0;
  let pendingRemainderCancellation: {
    generation: number;
    clientRowKey: string;
    billId: string;
    billKey: string;
    rowKey: string;
    fingerprint: string;
  } | null = null;
  const totals = computed(() => authoritativeBillTotals(billSnapshot.value));
  const replacePrompt = computed(
    () =>
      importMode.value === "append"
        ? `将把预检行追加到现有 ${rows.value.length} 行之后，确认后自动保存草稿，不会提交审批。`
        : `将替换当前 ${rows.value.length} 行清单，请核对后再确认；只保存草稿，不会提交审批。`
  );

  function locked(): boolean {
    return options.disabled() || busy.value;
  }

  function addRow() {
    if (locked()) return;
    const next = addBillCandidateRow(rows.value);
    next.at(-1)!.clientRowKey = crypto.randomUUID();
    replaceCandidateRows(next);
    selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
  }

  function copySelectedRow() {
    if (locked()) return;
    const beforeLength = rows.value.length;
    const next = copyBillCandidateRow(rows.value, selectedClientRowKey.value);
    if (next.length > beforeLength) next.at(-1)!.clientRowKey = crypto.randomUUID();
    replaceCandidateRows(next);
    if (rows.value.length > beforeLength) {
      selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
    }
  }

  function deleteSelectedRow() {
    if (locked()) return;
    if (selectedRowHasRemainderCancellationCapability.value) {
      setError("该行已有历史履约占用，不能使用普通删除；请使用“取消未实施余量”。");
      return;
    }
    replaceCandidateRows(
      removeBillCandidateRow(rows.value, selectedClientRowKey.value)
    );
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
  }

  function openRemainderCancellation() {
    if (locked()) return;
    if (remainderCancellationRetryLocked.value) {
      setError(
        remainderCancellationRetryLock.value?.message ??
          "操作已提交，请手动刷新核对，不要重复提交。"
      );
      return;
    }
    const capability = selectedRowCapability.value;
    const row = rows.value.find(
      (candidate) => candidate.clientRowKey === selectedClientRowKey.value
    );
    if (!capability || !row?.rowKey || !capability.action.enabled) {
      setError(
        capability?.action.disabledReason ||
          "当前行不允许取消未实施余量，请刷新后重试"
      );
      return;
    }
    remainderCancellationDialogGeneration += 1;
    pendingRemainderCancellation = {
      generation: remainderCancellationDialogGeneration,
      clientRowKey: row.clientRowKey,
      billId: billSnapshot.value.id,
      billKey: billSnapshot.value.billKey,
      rowKey: row.rowKey,
      fingerprint: remainderCancellationCapabilityFingerprint(capability)
    };
    remainderCancellationError.value = "";
    remainderCancellationVisible.value = true;
  }

  async function confirmRemainderCancellation(values: {
    reason: string;
    password: string;
  }) {
    if (remainderCancellationBusy.value) return;
    const pending = pendingRemainderCancellation;
    const row = pending
      ? rows.value.find((candidate) => candidate.clientRowKey === pending.clientRowKey)
      : undefined;
    const capability = remainderCancellationCapability(row);
    const reason = values.reason.trim();
    if (
      !pending ||
      !row?.rowKey ||
      row.rowKey !== pending.rowKey ||
      billSnapshot.value.id !== pending.billId ||
      billSnapshot.value.billKey !== pending.billKey ||
      !capability ||
      !capability.action.enabled ||
      remainderCancellationCapabilityFingerprint(capability) !== pending.fingerprint
    ) {
      remainderCancellationError.value =
        "当前清单余量能力已变化，请关闭后按最新行重新确认";
      return;
    }
    if (!reason || reason.length > 500) {
      remainderCancellationError.value = reason
        ? "操作原因不能超过 500 字"
        : "请填写取消未实施余量的原因";
      return;
    }
    if (!options.executeRemainderCancellation) {
      remainderCancellationError.value =
        "当前页面未连接余量取消操作，请刷新后重试";
      return;
    }
    const generation = pending.generation;
    remainderCancellationBusy.value = true;
    remainderCancellationError.value = "";
    try {
      const result = await options.executeRemainderCancellation({
        billId: pending.billId,
        billKey: pending.billKey,
        rowKey: pending.rowKey,
        reason
      });
      if (generation !== remainderCancellationDialogGeneration) return;
      if (result?.status === "submitted_refresh_failed") {
        remainderCancellationRetryLock.value = {
          billId: pending.billId,
          billKey: pending.billKey,
          rowKey: pending.rowKey,
          message: result.message
        };
        remainderCancellationVisible.value = false;
        pendingRemainderCancellation = null;
        message.value = result.message;
        messageDanger.value = true;
        return;
      }
      remainderCancellationVisible.value = false;
      pendingRemainderCancellation = null;
      message.value = "未实施余量已按历史完成量收敛";
      messageDanger.value = false;
    } catch (error) {
      if (generation !== remainderCancellationDialogGeneration) return;
      remainderCancellationError.value = errorMessage(
        error,
        "取消未实施余量失败，请核对服务端最新状态"
      );
    } finally {
      if (generation === remainderCancellationDialogGeneration) {
        remainderCancellationBusy.value = false;
      }
    }
  }

  function moveSelectedRow(offset: -1 | 1) {
    if (locked()) return;
    replaceCandidateRows(
      moveBillCandidateRow(rows.value, selectedClientRowKey.value, offset)
    );
  }

  function setRows(nextRows: ContractBillCandidateRow[]) {
    if (locked()) return;
    replaceCandidateRows(
      invalidateChangedAuthoritativePricing(rows.value, nextRows)
    );
  }

  async function previewExcel(file: File) {
    clearMessage();
    if (locked()) return;
    if (!isXlsxFile(file)) {
      setError("仅支持上传 .xlsx 格式的系统标准模板");
      return;
    }
    const contractVersionId = options.contractVersionId().trim();
    if (!contractVersionId) {
      setError("缺少合同版本，无法预检清单");
      return;
    }
    busy.value = true;
    try {
      if (!importUpload || importUpload.file !== file || importUpload.versionId !== contractVersionId || importUpload.billKey !== billSnapshot.value.billKey) {
        importUpload = { file, versionId: contractVersionId, billKey: billSnapshot.value.billKey, requestKey: crypto.randomUUID() };
      }
      if (!importUpload.id) {
        const uploaded = await dependencies.uploadFile(contractVersionId, file, file.name, importUpload.requestKey);
        importUpload.id = uploaded.id;
      }
      const uploaded = { id: importUpload.id };
      const result = normalizeImportPreview(
        await dependencies.previewImport(
          contractVersionId,
          billSnapshot.value.billKey,
          { fileId: uploaded.id, mode: importMode.value }
        )
      );
      preview.value = result;
      if (
        result.billKey !== billSnapshot.value.billKey ||
        result.targetBillRevision !== billSnapshot.value.revision
      ) {
        pendingImportRows.value = null;
        replaceConfirmVisible.value = false;
        setError("清单已更新，请刷新当前合同版本后重新预检");
        return;
      }
      if (result.errors.length) {
        pendingImportRows.value = null;
        replaceConfirmVisible.value = false;
        setError(result.errors.map((error) => error.message).join("；"));
        return;
      }
      if (importMode.value === "replace" && !preservesGovernedBillRowKeys(rows.value, result.candidateRows)) {
        pendingImportRows.value = null;
        replaceConfirmVisible.value = false;
        setError(
          "Excel 预检候选遗漏了已有历史履约占用行，不能整表替换；请刷新后保留该行。"
        );
        return;
      }
      pendingImportRows.value = cloneRows(result.candidateRows);
      replaceConfirmVisible.value = true;
      message.value = "Excel 预检完成，请确认是否载入当前合同草稿";
    } catch (error) {
      const unavailable = error instanceof Error && "status" in error && typeof error.status === "number" && error.status >= 500;
      setError(unavailable
        ? "上传或预检结果暂时无法确认，已保留选中文件；请检查网络或稍后重试。"
        : `${formatUnknownApiError(error, "导入预检失败")}；已保留选中文件，可修改后重选或重试预检。`);
    } finally {
      busy.value = false;
    }
  }

  function cancelImportFile() {
    importUpload = null;
    preview.value = null;
    pendingImportRows.value = null;
    replaceConfirmVisible.value = false;
    clearMessage();
    message.value = "已取消本次文件预检，当前草稿未改变";
  }

  function cancelImportReplace() {
    replaceConfirmVisible.value = false;
    pendingImportRows.value = null;
    message.value = "已取消载入，当前本地候选保持不变";
    messageDanger.value = false;
  }

  function confirmImportReplace() {
    if (!pendingImportRows.value || locked()) return;
    if (importMode.value === "replace" && !preservesGovernedBillRowKeys(rows.value, pendingImportRows.value)) {
      pendingImportRows.value = null;
      replaceConfirmVisible.value = false;
      setError(
        "Excel 预检候选遗漏了已有历史履约占用行，不能整表替换；请刷新后保留该行。"
      );
      return;
    }
    lastImport.value = { before: cloneRows(rows.value), importedKeys: pendingImportRows.value.map(row => row.clientRowKey) };
    replaceCandidateRows(importMode.value === "append" ? [...rows.value, ...pendingImportRows.value] : pendingImportRows.value);
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    pendingImportRows.value = null;
    replaceConfirmVisible.value = false;
    message.value = "Excel 预检结果已载入当前填写，请查看保存状态；尚未提交业务";
    messageDanger.value = false;
  }

  function undoImport() {
    if (locked() || !lastImport.value) return;
    const { before, importedKeys } = lastImport.value;
    const next = rows.value.filter(row => !importedKeys.includes(row.clientRowKey));
    before.forEach((row, index) => {
      if (!next.some(current => current.clientRowKey === row.clientRowKey)) next.splice(Math.min(index, next.length), 0, row);
    });
    replaceCandidateRows(next);
    lastImport.value = null;
    message.value = "已撤销本次导入，其他填写保持不变，等待保存草稿";
  }

  async function downloadTemplate() {
    clearMessage();
    if (busy.value) return;
    const contractVersionId = options.contractVersionId().trim();
    if (!contractVersionId) {
      setError("缺少合同版本，无法下载清单模板");
      return;
    }
    busy.value = true;
    try {
      await dependencies.downloadTemplate(
        contractVersionId,
        billSnapshot.value.billKey
      );
      message.value = "标准模板已下载";
    } catch (error) {
      setError(errorMessage(error, "下载标准模板失败"));
    } finally {
      busy.value = false;
    }
  }

  function syncBill(nextBill: WorkbenchBill) {
    const bindings = nextBill.acknowledgedRowKeys ?? {};
    if (lastImport.value) lastImport.value.before = lastImport.value.before.map(row =>
      reconcileUndoRowReceipt(row, bindings, nextBill.acknowledgedDeletions));
    const nextSnapshot = cloneBill(nextBill);
    const nextRows = fromWorkbenchBill(nextSnapshot);
    billSnapshot.value = nextSnapshot;
    if (candidateDigest(nextRows) !== candidateDigest(rows.value)) {
      rows.value = cloneRows(nextRows);
      if (!rows.value.some(row => row.clientRowKey === selectedClientRowKey.value)) selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    }
    errors.value = validateBillCandidateRows(rows.value, billSnapshot.value);
    if (pendingRemainderCancellation) {
      const pendingRow = rows.value.find(
        (row) => row.clientRowKey === pendingRemainderCancellation?.clientRowKey
      );
      const capability = remainderCancellationCapability(pendingRow);
      if (
        !capability ||
        remainderCancellationCapabilityFingerprint(capability) !==
          pendingRemainderCancellation.fingerprint
      ) {
        remainderCancellationDialogGeneration += 1;
        pendingRemainderCancellation = null;
        remainderCancellationVisible.value = false;
        remainderCancellationBusy.value = false;
      }
    }
  }

  function replaceCandidateRows(
    nextRows: readonly ContractBillCandidateRow[]
  ) {
    rows.value = cloneRows(nextRows);
    errors.value = validateBillCandidateRows(rows.value, billSnapshot.value);
    clearMessage();
    options.emit("update:rows", cloneRows(rows.value));
    options.emit("edited");
  }

  function clearMessage() {
    message.value = "";
    messageDanger.value = false;
  }

  function setError(nextMessage: string) {
    message.value = nextMessage;
    messageDanger.value = true;
  }

  return {
    billSnapshot,
    rows,
    errors,
    busy,
    message,
    messageDanger,
    preview,
    importMode,
    importUndoAvailable,
    undoImport,
    replaceConfirmVisible,
    pendingImportRows,
    selectedClientRowKey,
    selectedRowCapability,
    selectedRowHasRemainderCancellationCapability,
    remainderCancellationVisible,
    remainderCancellationBusy,
    remainderCancellationError,
    remainderCancellationRetryLocked,
    totals,
    replacePrompt,
    addRow,
    copySelectedRow,
    deleteSelectedRow,
    openRemainderCancellation,
    confirmRemainderCancellation,
    moveSelectedRow,
    setRows,
    previewExcel,
    cancelImportReplace,
    cancelImportFile,
    confirmImportReplace,
    downloadTemplate,
    syncBill
  };
}

function normalizeImportPreview(
  value: ContractDraftBillExcelImportPreview
): BillImportPreview {
  const candidateRows: ContractBillCandidateRow[] = [];
  const errors: BillImportPreview["errors"] = value.errors.map((error) => ({ ...error, message: error.sheet && error.row && error.column ? `${error.sheet} 第 ${error.row} 行 ${error.column} 列：${error.message}` : error.message }));
  value.rows.forEach((row, index) => {
    const candidate = importCandidateRow(row);
    if (candidate) {
      candidateRows.push(candidate);
    } else {
      errors.push({
        message: `Excel 预检第 ${index + 1} 行缺少完整候选字段`
      });
    }
  });
  return {
    billKey: value.billKey,
    targetBillRevision: value.targetBillRevision,
    added: value.added,
    skipped: value.skipped,
    errors,
    sourceColumns: value.sourceColumns ?? [],
    sourceRows: value.sourceRows ?? [],
    candidateRows: errors.length ? [] : candidateRows
  };
}

function importCandidateRow(value: unknown): ContractBillCandidateRow | null {
  if (!isRecord(value)) return null;
  const clientRowKey = requiredText(value["clientRowKey"]);
  const itemName = requiredText(value["itemName"]);
  const unit = requiredText(value["unit"]);
  const unitPrice = typeof value["unitPrice"] === "string" ? value["unitPrice"] : null;
  if (
    !clientRowKey ||
    !itemName ||
    !unit ||
    unitPrice === null ||
    !isRecord(value["customData"])
  ) {
    return null;
  }
  if (
    value["taxRateSource"] !== undefined &&
    value["taxRateSource"] !== "version_default" &&
    value["taxRateSource"] !== "row_override"
  ) {
    return null;
  }
  return {
    clientRowKey,
    ...(optionalText(value["rowKey"])
      ? { rowKey: optionalText(value["rowKey"]) }
      : {}),
    itemCode: optionalText(value["itemCode"]),
    itemName,
    specification: optionalText(value["specification"]),
    unit,
    quantity: optionalText(value["quantity"]),
    unitPrice,
    taxRatePercent: optionalText(value["taxRatePercent"]),
    taxRateSource:
      value["taxRateSource"] === "row_override"
        ? "row_override"
        : "version_default",
    isProvisional: value["isProvisional"] === true,
    settlementBasis: optionalText(value["settlementBasis"]),
    customData: Object.fromEntries(
      Object.entries(value["customData"]).map(([key, entry]) => [
        key,
        entry === null || entry === undefined ? "" : String(entry)
      ])
    )
  };
}

function reconcileUndoRowReceipt(
  row: ContractBillCandidateRow,
  bindings: Record<string, string>,
  deletions: WorkbenchBill["acknowledgedDeletions"]
): ContractBillCandidateRow {
  const next = { ...row };
  if (!next.rowKey && bindings[next.clientRowKey]) {
    next.rowKey = bindings[next.clientRowKey];
    delete next.restoreRef;
    delete next.restoreOriginalValues;
  }
  const deletion = deletions?.find(ref => ref.oldRowKey === next.rowKey);
  if (deletion) {
    next.restoreRef = { saveIntentKey: deletion.saveIntentKey, oldRowKey: deletion.oldRowKey };
    next.restoreOriginalValues = JSON.parse(JSON.stringify(deletion.originalValues)) as Record<string, unknown>;
    delete next.rowKey;
  }
  return next;
}

function cloneRows(
  rows: readonly ContractBillCandidateRow[]
): ContractBillCandidateRow[] {
  return rows.map((row) => ({
    ...row,
    customData: { ...row.customData },
    ...(row.availableActions
      ? { availableActions: row.availableActions.map((action) => ({ ...action })) }
      : {}),
    ...(row.remainderCancellation
      ? { remainderCancellation: { ...row.remainderCancellation } }
      : {})
  }));
}

function cloneBill(bill: WorkbenchBill): WorkbenchBill {
  return {
    ...bill,
    inputNumericProtocolVersion: 2,
    schemaSnapshot: bill.schemaSnapshot
      ? { ...bill.schemaSnapshot }
      : bill.schemaSnapshot,
    rows: bill.rows.map((row) => ({
      ...row,
      customData: { ...(row.customData ?? {}) },
      ...(row.availableActions
        ? { availableActions: row.availableActions.map((action) => ({ ...action })) }
        : {}),
      ...(row.remainderCancellation
        ? { remainderCancellation: { ...row.remainderCancellation } }
        : {})
    }))
  };
}

function remainderCancellationCapability(
  row: ContractBillCandidateRow | undefined
): SelectedRowRemainderCancellationCapability | null {
  if (!row?.remainderCancellation) return null;
  const availableActions = (row.availableActions ?? []).filter(
    (action) => action.key === "contract-bill.remainder-cancellation"
  );
  if (availableActions.length !== 1) return null;
  const action = availableActions[0]!;
  const facts = row.remainderCancellation;
  const expectedOccupancyToken = facts.expectedOccupancyToken;
  const historicalQuantity = facts.historicalQuantity;
  const historicalAmountCents = facts.historicalAmountCents;
  if (
    !Number.isInteger(facts.expectedBillRevision) ||
    !Number.isInteger(facts.expectedDraftRevision) ||
    typeof expectedOccupancyToken !== "string" ||
    !expectedOccupancyToken.trim() ||
    typeof historicalQuantity !== "string" ||
    !historicalQuantity.trim() ||
    typeof historicalAmountCents !== "string" ||
    !/^\d+$/u.test(historicalAmountCents)
  ) {
    return null;
  }
  return { availableActions, action, facts };
}

function remainderCancellationCapabilityFingerprint(
  capability: SelectedRowRemainderCancellationCapability
) {
  return [
    capability.action.key,
    Number(capability.action.enabled),
    capability.action.disabledReason ?? "",
    Number(Boolean(capability.action.requiresComment)),
    Number(Boolean(capability.action.requiresPassword)),
    capability.facts.expectedBillRevision,
    capability.facts.expectedDraftRevision,
    capability.facts.expectedOccupancyToken,
    capability.facts.historicalQuantity,
    capability.facts.historicalAmountCents
  ].join("\u0000");
}

function candidateDigest(rows: readonly ContractBillCandidateRow[]) {
  return JSON.stringify(rows);
}

function isXlsxFile(file: File) {
  return file.name.trim().toLowerCase().endsWith(".xlsx");
}

function requiredText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "";
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}
</script>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { nextTick, watch } from "vue";
import SensitiveActionDialog from "../../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText } from "../../../lib/money";
import ContractBillGrid from "./ContractBillGrid.vue";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { ColumnRegular } from "@revolist/vue3-datagrid";

const props = defineProps<{
  bill: WorkbenchBill;
  contractVersionId: string;
  disabled: boolean;
  actionDisabled?: boolean;
  remoteDisabled?: boolean;
  actionHandler?: (
    request: ContractBillRemainderCancellationRequest
  ) => Promise<ContractBillRemainderCancellationExecutionResult | void>;
}>();

const emit = defineEmits<{
  close: [];
  "update:rows": [rows: ContractBillCandidateRow[]];
  "editor-input": [state: { pending: boolean; edited: boolean }];
  edited: [];
}>();

const importFiles = ref<UploadFile[]>([]);
const retainedImportFile = ref<File | null>(null);
const uploadRef = ref<{ $el?: HTMLElement } | null>(null);
const billGridRef = ref<InstanceType<typeof ContractBillGrid> | null>(null);
const importSourceGridRef = ref<InstanceType<typeof JgBusinessGrid> | null>(null);
const importTarget = ref<{ row: number; column: string } | null>(null);
const selectedKeys = ref<string[]>([]);
const selectionAnchor = ref<string | null>(null);
const deletedRows = ref<Array<{ row: ContractBillCandidateRow; index: number }> | null>(null);
const controller = createContractBillFocusController({
  bill: () => props.bill,
  contractVersionId: () => props.contractVersionId,
  disabled: () => props.disabled,
  executeRemainderCancellation: (request) =>
    props.actionHandler
      ? props.actionHandler(request)
      : Promise.reject(new Error("当前页面未连接余量取消操作")),
  emit: (event, value) => {
    if (event === "close") emit("close");
    if (event === "update:rows") {
      emit("update:rows", value as ContractBillCandidateRow[]);
    }
    if (event === "edited") emit("edited");
  }
});

function toggleSelection(key: string | null, shift: boolean) {
  if (props.disabled || controller.busy.value) return;
  if (key === null) {
    selectedKeys.value = selectedKeys.value.length === controller.rows.value.length ? [] : controller.rows.value.map(row => row.clientRowKey);
    return;
  }
  const selected = new Set(selectedKeys.value);
  const include = !selected.has(key);
  const keys = controller.rows.value.map(row => row.clientRowKey);
  const from = selectionAnchor.value === null ? -1 : keys.indexOf(selectionAnchor.value);
  const to = keys.indexOf(key);
  const affected = shift && from >= 0 ? keys.slice(Math.min(from, to), Math.max(from, to) + 1) : [key];
  for (const candidate of affected) include ? selected.add(candidate) : selected.delete(candidate);
  selectedKeys.value = [...selected];
  selectionAnchor.value = key;
}

async function copySelection() {
  if (props.disabled || controller.busy.value) return;
  const current = controller.rows.value;
  const selected = current.filter(row => selectedKeys.value.includes(row.clientRowKey));
  const copies: ContractBillCandidateRow[] = [];
  for (const row of selected) copies.push({ ...copyBillCandidateRow([...current, ...copies], row.clientRowKey).at(-1)!, clientRowKey: crypto.randomUUID() });
  if (!copies.length) return;
  const index = Math.max(...selected.map(row => current.indexOf(row))) + 1;
  controller.setRows([...current.slice(0, index), ...copies, ...current.slice(index)]);
  selectedKeys.value = copies.map(row => row.clientRowKey);
  const newKey = copies[0]!.clientRowKey;
  controller.selectedClientRowKey.value = newKey;
  await nextTick();
  await billGridRef.value?.focusReadinessCell(newKey, "itemName", true);
}

function deleteRowsByKeys(keys: string[]) {
  if (props.disabled || controller.busy.value) return;
  const current = controller.rows.value;
  if (current.some(row => keys.includes(row.clientRowKey) && rowHasRemainderCancellationCapability(row))) return;
  deletedRows.value = current.flatMap((row, index) => keys.includes(row.clientRowKey) ? [{ row: { ...row, customData: { ...row.customData } }, index }] : []);
  controller.setRows(current.filter(row => !keys.includes(row.clientRowKey)));
  selectedKeys.value = selectedKeys.value.filter(key => !keys.includes(key));
}
function deleteSelection() { deleteRowsByKeys(selectedKeys.value); }
async function addRowAndFocus() {
  controller.addRow();
  const newKey = controller.selectedClientRowKey.value;
  await nextTick();
  await billGridRef.value?.focusReadinessCell(newKey, "itemName", true);
}
async function copySelectedRowAndFocus() {
  if (props.disabled || controller.busy.value) return;
  controller.copySelectedRow();
  const newKey = controller.selectedClientRowKey.value;
  await nextTick();
  await billGridRef.value?.focusReadinessCell(newKey, "itemName", true);
}
async function copyRow(index: number) {
  const row = controller.rows.value[index];
  if (!row || props.disabled || controller.busy.value) return;
  controller.selectedClientRowKey.value = row.clientRowKey;
  await copySelectedRowAndFocus();
}
function deleteRow(index: number) {
  const row = controller.rows.value[index];
  if (row) deleteRowsByKeys([row.clientRowKey]);
}
async function moveRow(index: number, offset: -1 | 1) {
  const row = controller.rows.value[index];
  if (!row || props.disabled || controller.busy.value) return;
  controller.selectedClientRowKey.value = row.clientRowKey;
  controller.moveSelectedRow(offset);
  await nextTick();
  await billGridRef.value?.focusReadinessCell(row.clientRowKey, "itemName");
}

function undoDeletion() {
  if (props.disabled || controller.busy.value || !deletedRows.value) return;
  const next = [...controller.rows.value];
  for (const { row, index } of deletedRows.value) {
    if (!next.some(current => current.clientRowKey === row.clientRowKey)) next.splice(Math.min(index, next.length), 0, row);
  }
  selectedKeys.value = deletedRows.value.map(item => item.row.clientRowKey);
  controller.setRows(next);
  deletedRows.value = null;
}

const importSourceRows = computed(() => (controller.preview.value?.sourceRows ?? []).map(source => ({ ...source.values, __excelRow: String(source.row) })));
const importSourceColumns = computed<ColumnRegular[]>(() => [
  { prop: "__excelRow", name: "Excel行", size: 80, pin: "colPinStart", readonly: true },
  ...(controller.preview.value?.sourceColumns ?? []).map(column => ({
    prop: column.key, name: `${column.column} ${column.label}`, size: 150, readonly: true,
    cellProperties: ({ model }: { model: unknown }) => {
      const row = Number((model as Record<string, unknown>)["__excelRow"]);
      const invalid = controller.preview.value?.errors.some(error => error.row === row && error.column === column.column);
      const target = importTarget.value?.row === row && importTarget.value.column === column.column;
      return { className: `${invalid ? "import-source--error" : ""} ${target ? "import-source--target" : ""}` };
    }
  }))
]);
async function locateImportCell(error: BillImportPreview["errors"][number]) {
  const source = controller.preview.value;
  const row = source?.sourceRows.findIndex(item => item.row === error.row) ?? -1;
  const column = source?.sourceColumns.find(item => item.column === error.column);
  if (row < 0 || !column || error.row === undefined || error.column === undefined) return;
  importTarget.value = { row: error.row, column: error.column };
  await nextTick();
  await importSourceGridRef.value?.focusCell(row, column.key);
}
watch(() => controller.preview.value, () => { importTarget.value = null; });

const {
  billSnapshot,
  rows,
  errors,
  busy,
  message,
  messageDanger,
  preview,
  importMode,
  importUndoAvailable,
  replaceConfirmVisible,
  selectedClientRowKey,
  selectedRowCapability,
  selectedRowHasRemainderCancellationCapability,
  remainderCancellationVisible,
  remainderCancellationBusy,
  remainderCancellationError,
  remainderCancellationRetryLocked,
  totals,
  replacePrompt
} = controller;

const currentTotal = computed(() => previewBillGross(rows.value, billSnapshot.value));
const selectedTotal = computed(() => previewBillGross(rows.value.filter(row => selectedKeys.value.includes(row.clientRowKey)), billSnapshot.value));

const totalsText = computed(() =>
  totals.value.kind === "decimal" ? {
    exclusive: totals.value.taxExclusiveAmountYuan === null ? "待确定" : `${totals.value.taxExclusiveAmountYuan} 元`,
    tax: totals.value.taxAmountYuan === null ? "待确定" : `${totals.value.taxAmountYuan} 元`,
    inclusive: totals.value.taxInclusiveAmountYuan === null ? "待确定" : `${totals.value.taxInclusiveAmountYuan} 元`
  } : totals.value.kind === "authoritative"
    ? {
        exclusive: moneyText(totals.value.taxExclusiveAmountCents),
        tax: moneyText(totals.value.taxAmountCents),
        inclusive: moneyText(totals.value.taxInclusiveAmountCents)
      }
    : { exclusive: "—", tax: "—", inclusive: "—" }
);

const remainderCancellationDescription = computed(() => {
  const capability = selectedRowCapability.value;
  if (!capability) {
    return "将未实施余量收敛到服务端核定的历史完成量。";
  }
  return `将当前合同数量收敛为历史完成量 ${capability.facts.historicalQuantity}，历史金额 ${moneyText(capability.facts.historicalAmountCents)}。该操作不删除历史履约记录。`;
});

watch(
  () => props.bill,
  (bill) => {
    const bindings = bill.acknowledgedRowKeys ?? {};
    if (deletedRows.value) deletedRows.value = deletedRows.value.map(entry => ({
      ...entry, row: reconcileUndoRowReceipt(entry.row, bindings, bill.acknowledgedDeletions)
    }));
    controller.syncBill(bill);
    const currentKeys = new Set(controller.rows.value.map(row => row.clientRowKey));
    selectedKeys.value = selectedKeys.value.filter(key => currentKeys.has(key));
  },
  { deep: true }
);

function openImportPicker() {
  if (props.disabled || props.remoteDisabled || busy.value) return;
  const input = uploadRef.value?.$el?.querySelector<HTMLInputElement>(
    'input[type="file"]'
  );
  input?.click();
}

function requestClose() {
  emit("close");
}

async function onFileSelected(files: UploadFile[]) {
  const raw = files[0]?.raw;
  retainedImportFile.value = raw instanceof File ? raw : null;
  if (retainedImportFile.value) await retryImportFileSelection();
}

async function retryImportFileSelection() {
  const file = retainedImportFile.value;
  if (!file || props.disabled || props.remoteDisabled || busy.value) return;
  await controller.previewExcel(file);
  if (!messageDanger.value) {
    importFiles.value = [];
    retainedImportFile.value = null;
  }
}

function cancelImportFileSelection() {
  importFiles.value = [];
  retainedImportFile.value = null;
  controller.cancelImportFile();
}

async function confirmRemainderCancellation(values: {
  reason: string;
  password: string;
}) {
  await controller.confirmRemainderCancellation(values);
}

function moneyText(value: string) {
  return `${centsTextToYuanText(value)} 元`;
}

async function focusReadinessIssue(
  rowKey: string,
  fieldKey: string
): Promise<boolean> {
  const row = rows.value.find(
    (candidate) =>
      candidate.rowKey === rowKey || candidate.clientRowKey === rowKey
  );
  if (!row) return false;
  selectedClientRowKey.value = row.clientRowKey;
  await nextTick();
  return (
    (await billGridRef.value?.focusReadinessCell(rowKey, fieldKey)) ?? false
  );
}

defineExpose({ openImportPicker, focusReadinessIssue });
</script>

<template>
  <section class="bill-focus-editor">
    <header class="focus-head">
      <div>
        <t-button
          variant="text"
          data-testid="bill-focus-close"
          @click="requestClose"
        >
          返回合同
        </t-button>
        <h2>{{ billSnapshot.name }}</h2>
        <span class="save-status">清单修改由顶部统一保存</span>
      </div>
    </header>

    <div class="focus-toolbar">
      <t-button
        data-testid="bill-add-row"
        :disabled="disabled || busy"
        @click="addRowAndFocus"
      >
        新增行
      </t-button>
      <t-button
        data-testid="bill-copy-row"
        :disabled="disabled || busy || !selectedClientRowKey"
        @click="copySelectedRowAndFocus"
      >
        复制行
      </t-button>
      <t-button
        data-testid="bill-delete-row"
        :disabled="disabled || busy || !selectedClientRowKey || selectedRowHasRemainderCancellationCapability"
        @click="controller.deleteSelectedRow"
      >
        删除行
      </t-button>
      <t-button
        v-if="selectedRowHasRemainderCancellationCapability"
        theme="danger"
        data-testid="bill-cancel-remainder"
        :disabled="disabled || actionDisabled || busy || remainderCancellationBusy || remainderCancellationRetryLocked || !selectedRowCapability?.action.enabled"
        :title="remainderCancellationRetryLocked ? message : selectedRowCapability?.action.disabledReason ?? undefined"
        @click="controller.openRemainderCancellation"
      >
        {{ selectedRowCapability?.action.label ?? "取消未实施余量" }}
      </t-button>
      <t-button
        data-testid="bill-move-up"
        :disabled="disabled || busy || !selectedClientRowKey"
        @click="controller.moveSelectedRow(-1)"
      >
        上移
      </t-button>
      <t-button
        data-testid="bill-move-down"
        :disabled="disabled || busy || !selectedClientRowKey"
        @click="controller.moveSelectedRow(1)"
      >
        下移
      </t-button>
      <t-button
        variant="outline"
        :disabled="disabled || remoteDisabled || busy"
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
        :disabled="disabled || remoteDisabled || busy"
        :loading="busy"
        placeholder="导入 Excel"
        @change="onFileSelected"
        @remove="cancelImportFileSelection"
      />
      <template v-if="retainedImportFile && messageDanger">
        <t-button
          data-testid="bill-import-retry"
          :disabled="disabled || remoteDisabled || busy"
          @click="retryImportFileSelection"
        >
          重试预检已选文件
        </t-button>
        <t-button
          data-testid="bill-import-file-cancel"
          variant="text"
          :disabled="busy"
          @click="cancelImportFileSelection"
        >
          取消已选文件
        </t-button>
      </template>
    </div>

    <t-alert
      v-if="message"
      :theme="messageDanger ? 'error' : 'success'"
      :message="message"
    />

    <section
      v-if="preview?.sourceRows.length"
      aria-label="Excel 源文件预览"
      class="import-source-preview"
    >
      <strong>源文件预览（只读，请在 Excel 修改后重新上传）</strong>
      <div class="focus-toolbar">
        <t-button
          v-for="(error, index) in preview.errors"
          :key="index"
          variant="outline"
          :aria-label="`定位 ${error.sheet} ${error.column}${error.row}`"
          @click="locateImportCell(error)"
        >
          {{ error.column }}{{ error.row }}：{{ error.message }}
        </t-button>
      </div>
      <JgBusinessGrid
        ref="importSourceGridRef"
        data-testid="bill-import-source-grid"
        :source="importSourceRows"
        :columns="importSourceColumns"
        readonly
        :min-height="240"
      />
    </section>

    <div
      v-if="errors.length"
      class="error-summary"
    >
      <strong>{{ errors.length }} 处需要修正</strong>
      <span>{{ errors[0]?.message }}</span>
    </div>

    <p class="bill-precision-note">
      数量、含税单价最多填写4位小数；空白表示待确定，0表示已约定零值。历史原值保留，需核对后再修改。
    </p>
    <div class="focus-toolbar">
      <span>{{ selectedKeys.length ? `已选择 ${selectedKeys.length} 行` : '勾选行后可批量操作；单元格焦点不改变勾选' }}</span>
      <span data-testid="bill-selected-total">所选含税合计 {{ selectedTotal }}</span>
      <t-button
        :disabled="disabled || busy || !selectedKeys.length"
        @click="copySelection"
      >
        复制所选
      </t-button>
      <t-button
        :disabled="disabled || busy || !selectedKeys.length"
        @click="deleteSelection"
      >
        删除所选
      </t-button>
      <t-button
        :disabled="!selectedKeys.length"
        @click="selectedKeys = []"
      >
        取消选择
      </t-button>
      <t-button
        :disabled="disabled || busy || !deletedRows"
        @click="undoDeletion"
      >
        撤销删除
      </t-button>
      <t-button
        :disabled="disabled || busy || !importUndoAvailable"
        @click="controller.undoImport"
      >
        撤销本次导入
      </t-button>
    </div>
    <ContractBillGrid
      ref="billGridRef"
      data-testid="contract-bill-grid"
      :bill="billSnapshot"
      :rows="rows"
      :errors="errors"
      :readonly="disabled || busy"
      :selected-keys="selectedKeys"
      @toggle-selection="toggleSelection"
      @select-rows="selectedKeys = $event ? rows.map(row => row.clientRowKey) : []"
      @copy-row="copyRow"
      @delete-row="deleteRow"
      @move-row="moveRow"
      @update:rows="controller.setRows"
      @editor-input="emit('editor-input', $event)"
      @select-row="selectedClientRowKey = $event"
    />

    <t-button
      data-testid="bill-add-bottom"
      :disabled="disabled || busy"
      @click="addRowAndFocus"
    >
      新增一行
    </t-button>
    <footer class="focus-summary">
      <span data-testid="bill-current-total">当前清单含税合计 <strong>{{ currentTotal }}</strong></span>
      <span>候选行数 <strong>{{ rows.length }}</strong></span>
      <span>上次保存不含税合计 <strong>{{ totalsText.exclusive }}</strong></span>
      <span>上次保存税额 <strong>{{ totalsText.tax }}</strong></span>
      <span>上次保存含税合计 <strong>{{ totalsText.inclusive }}</strong></span>
    </footer>

    <t-dialog
      v-model:visible="replaceConfirmVisible"
      header="确认载入 Excel 清单"
      role="dialog"
      aria-modal="true"
      aria-label="确认载入 Excel 清单"
      width="560px"
      :close-on-overlay-click="false"
      @close="controller.cancelImportReplace"
    >
      <t-radio-group
        v-model="importMode"
        aria-label="导入方式"
      >
        <t-radio value="append">
          追加到现有清单
        </t-radio>
        <t-radio value="replace">
          替换现有清单
        </t-radio>
      </t-radio-group>
      <p>{{ replacePrompt }}</p>
      <p v-if="preview">
        预检得到 {{ preview.candidateRows.length }} 行，新增 {{ preview.added }} 行，
        跳过 {{ preview.skipped }} 行。
      </p>
      <template #footer>
        <t-button
          variant="outline"
          data-testid="bill-import-cancel"
          @click="controller.cancelImportReplace"
        >
          取消，保留当前候选
        </t-button>
        <t-button
          theme="primary"
          data-testid="bill-import-confirm"
          @click="controller.confirmImportReplace"
        >
          载入合同草稿
        </t-button>
      </template>
    </t-dialog>

    <SensitiveActionDialog
      v-model="remainderCancellationVisible"
      title="取消未实施余量"
      :description="remainderCancellationDescription"
      confirm-text="确认取消余量"
      confirm-theme="danger"
      :require-reason="true"
      reason-label="取消原因"
      :loading="remainderCancellationBusy"
      :error="remainderCancellationError"
      @confirm="confirmRemainderCancellation"
    />
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
  color: var(--jg-color-warning);
  font-size: var(--jg-font-size-meta);
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
  background: var(--jg-color-bg-surface);
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

<style scoped>
.import-source-preview { min-width: 0; display: grid; gap: var(--jg-space-2); }
.import-source-preview :deep(.import-source--error) { background: var(--jg-color-danger-soft); }
.import-source-preview :deep(.import-source--target) { outline: 2px solid var(--jg-color-danger); outline-offset: -2px; }
</style>

<style scoped>
@media (max-width: 1080px), (max-height: 600px) {
  .focus-summary {
    position: static;
    justify-content: flex-start;
    background: var(--jg-color-bg-surface);
  }
}
</style>

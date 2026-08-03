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

async function uploadContractBillImportFileWithCapability(
  contractVersionId: string,
  file: Blob,
  fileName: string
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
  return uploadContractWorkbenchPrivateFile(contractVersionId, file, fileName);
}

async function previewContractDraftBillExcelImportWithCapability(
  contractVersionId: string,
  billKey: string,
  body: { fileId: string }
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
    fileName: string
  ) => Promise<UploadedFileReadModel>;
  previewImport: (
    contractVersionId: string,
    billKey: string,
    body: { fileId: string }
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
  confirmImportReplace: () => void;
  downloadTemplate: () => Promise<void>;
  syncBill: (bill: WorkbenchBill) => void;
}

interface BillImportPreview {
  billKey: string;
  targetBillRevision: number;
  added: number;
  skipped: number;
  errors: Array<{ message: string }>;
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
      `将以预检结果替换当前 ${rows.value.length} 行本地候选；确认后由右上角统一保存合同草稿。`
  );

  function locked(): boolean {
    return options.disabled() || busy.value;
  }

  function addRow() {
    if (locked()) return;
    replaceCandidateRows(addBillCandidateRow(rows.value));
    selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
  }

  function copySelectedRow() {
    if (locked()) return;
    const beforeLength = rows.value.length;
    replaceCandidateRows(
      copyBillCandidateRow(rows.value, selectedClientRowKey.value)
    );
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
      const uploaded = await dependencies.uploadFile(
        contractVersionId,
        file,
        file.name
      );
      const result = normalizeImportPreview(
        await dependencies.previewImport(
          contractVersionId,
          billSnapshot.value.billKey,
          { fileId: uploaded.id }
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
      if (!preservesGovernedBillRowKeys(rows.value, result.candidateRows)) {
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
      setError(errorMessage(error, "导入预检失败"));
    } finally {
      busy.value = false;
    }
  }

  function cancelImportReplace() {
    replaceConfirmVisible.value = false;
    pendingImportRows.value = null;
    message.value = "已取消载入，当前本地候选保持不变";
    messageDanger.value = false;
  }

  function confirmImportReplace() {
    if (!pendingImportRows.value || locked()) return;
    if (!preservesGovernedBillRowKeys(rows.value, pendingImportRows.value)) {
      pendingImportRows.value = null;
      replaceConfirmVisible.value = false;
      setError(
        "Excel 预检候选遗漏了已有历史履约占用行，不能整表替换；请刷新后保留该行。"
      );
      return;
    }
    replaceCandidateRows(pendingImportRows.value);
    selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
    pendingImportRows.value = null;
    replaceConfirmVisible.value = false;
    message.value = "Excel 预检结果已载入合同草稿，等待右上角统一保存";
    messageDanger.value = false;
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
    const nextSnapshot = cloneBill(nextBill);
    const nextRows = fromWorkbenchBill(nextSnapshot);
    billSnapshot.value = nextSnapshot;
    if (candidateDigest(nextRows) !== candidateDigest(rows.value)) {
      rows.value = cloneRows(nextRows);
      selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
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
    confirmImportReplace,
    downloadTemplate,
    syncBill
  };
}

function normalizeImportPreview(
  value: ContractDraftBillExcelImportPreview
): BillImportPreview {
  const candidateRows: ContractBillCandidateRow[] = [];
  const errors = value.errors.map((error) => ({ message: error.message }));
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
    candidateRows: errors.length ? [] : candidateRows
  };
}

function importCandidateRow(value: unknown): ContractBillCandidateRow | null {
  if (!isRecord(value)) return null;
  const clientRowKey = requiredText(value["clientRowKey"]);
  const itemName = requiredText(value["itemName"]);
  const unit = requiredText(value["unit"]);
  const unitPrice = requiredText(value["unitPrice"]);
  if (
    !clientRowKey ||
    !itemName ||
    !unit ||
    !unitPrice ||
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

const props = defineProps<{
  bill: WorkbenchBill;
  contractVersionId: string;
  disabled: boolean;
  actionDisabled?: boolean;
  actionHandler?: (
    request: ContractBillRemainderCancellationRequest
  ) => Promise<ContractBillRemainderCancellationExecutionResult | void>;
}>();

const emit = defineEmits<{
  close: [];
  "update:rows": [rows: ContractBillCandidateRow[]];
  edited: [];
}>();

const importFiles = ref<UploadFile[]>([]);
const uploadRef = ref<{ $el?: HTMLElement } | null>(null);
const billGridRef = ref<InstanceType<typeof ContractBillGrid> | null>(null);
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

const {
  billSnapshot,
  rows,
  errors,
  busy,
  message,
  messageDanger,
  preview,
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

const totalsText = computed(() =>
  totals.value.kind === "authoritative"
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
  (bill) => controller.syncBill(bill),
  { deep: true }
);

function openImportPicker() {
  if (props.disabled || busy.value) return;
  const input = uploadRef.value?.$el?.querySelector<HTMLInputElement>(
    'input[type="file"]'
  );
  input?.click();
}

function requestClose() {
  emit("close");
}

async function onFileSelected(files: UploadFile[]) {
  const raw = files[0]?.raw ?? importFiles.value[0]?.raw;
  const file = raw instanceof File ? raw : null;
  importFiles.value = [];
  if (file) await controller.previewExcel(file);
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
        @click="controller.addRow"
      >
        新增行
      </t-button>
      <t-button
        data-testid="bill-copy-row"
        :disabled="disabled || busy || !selectedClientRowKey"
        @click="controller.copySelectedRow"
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
        :disabled="disabled || busy"
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
        :disabled="disabled || busy"
        :loading="busy"
        placeholder="导入 Excel"
        @change="onFileSelected"
      />
    </div>

    <t-alert
      v-if="message"
      :theme="messageDanger ? 'error' : 'success'"
      :message="message"
    />

    <div
      v-if="errors.length"
      class="error-summary"
    >
      <strong>{{ errors.length }} 处需要修正</strong>
      <span>{{ errors[0]?.message }}</span>
    </div>

    <ContractBillGrid
      ref="billGridRef"
      data-testid="contract-bill-grid"
      :bill="billSnapshot"
      :rows="rows"
      :errors="errors"
      :readonly="disabled || busy"
      @update:rows="controller.setRows"
      @select-row="selectedClientRowKey = $event"
    />

    <footer class="focus-summary">
      <span>候选行数 <strong>{{ rows.length }}</strong></span>
      <span>上次保存不含税合计 <strong>{{ totalsText.exclusive }}</strong></span>
      <span>上次保存税额 <strong>{{ totalsText.tax }}</strong></span>
      <span>上次保存含税合计 <strong>{{ totalsText.inclusive }}</strong></span>
    </footer>

    <t-dialog
      v-model:visible="replaceConfirmVisible"
      header="确认载入 Excel 清单"
      width="560px"
      :close-on-overlay-click="false"
      @close="controller.cancelImportReplace"
    >
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

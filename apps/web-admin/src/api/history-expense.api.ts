import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type HistoryExpensePaymentStatus =
  | "paid"
  | "unpaid"
  | "partially_paid"
  | "unknown";

export type HistoryExpenseReviewOutcome = "verified" | "pending" | "not_occurred";

export interface HistoryExpenseIssue {
  code: string;
  severity: "error" | "warning";
  fieldKey?: string;
  message: string;
}

export interface HistoryExpenseCategorySummary {
  code: string;
  label: string;
  rowCount: number;
  amountCents: string;
  postedAmountCents: string;
}

export interface HistoryExpenseSummary {
  totalRows: number;
  verifiedRows: number;
  pendingRows: number;
  notOccurredRows: number;
  activatedRows: number;
  unknownPaymentRows: number;
  unpaidRows: number;
  zeroAmountRows: number;
  pendingSourceRows: number;
  totalAmountCents: string;
  verifiedAmountCents: string;
  postedAmountCents: string;
  pendingAmountCents: string;
  paidAmountCents: string;
  categories: HistoryExpenseCategorySummary[];
}

export interface HistoryExpenseRowReadModel {
  id: string;
  rowNo: number;
  businessRef: string | null;
  occurredAt: string | null;
  amountCents: string | null;
  paymentStatus: HistoryExpensePaymentStatus;
  paymentStatusLabel: string;
  paidAmountCents: string | null;
  costCategoryCode: string | null;
  reviewStatus: string;
  reviewStatusLabel: string;
  reviewConclusion: string | null;
  duplicateStatus: string;
  duplicateNote: string | null;
  revision: number;
  generatedFactId: string | null;
  values: Record<string, unknown>;
  issues: HistoryExpenseIssue[];
}

export interface HistoryExpenseBatchReadModel {
  id: string;
  projectId: string | null;
  companyEntityId?: string;
  batchNo: string;
  status: string;
  statusLabel: string;
  revision: number;
  importFingerprint: string;
  totalRows: number;
  activatedRows: number;
  pendingRows: number;
  verifiedRows: number;
  createdAt: string | null;
  activatedAt: string | null;
  summary: HistoryExpenseSummary;
  confirmation: {
    confirmedAt: string;
    confirmedByUserId: string;
    revision: number;
  } | null;
  canVerify: boolean;
  canConfirm: boolean;
  canActivate: boolean;
  canCorrect: boolean;
  rows: HistoryExpenseRowReadModel[];
}

export interface HistoryExpenseBatchListItem {
  id: string;
  batchNo: string;
  status: string;
  statusLabel: string;
  revision: number;
  totalRows: number;
  activatedRows: number;
  pendingRows: number;
  createdAt: string | null;
  activatedAt: string | null;
}

export interface HistoryExpensePrecheckResult {
  rows: Array<{
    rowNo: number;
    businessRef: string | null;
    occurredAt: string;
    amountCents: string;
    paidCents: string | null;
    paymentStatus: HistoryExpensePaymentStatus;
    costCategoryCode: string | null;
    values: Record<string, unknown>;
    issues: HistoryExpenseIssue[];
  }>;
  summary: HistoryExpenseSummary;
  zeroWrites: boolean;
  importFingerprint: string;
  blockingRows: number;
  warningRows: number;
}

export interface HistoryExpenseRowInput {
  values: Record<string, unknown>;
}

export interface HistoryExpenseCapability {
  projectId: string | null;
  companyEntityId?: string;
  paymentStatuses: Array<{ value: HistoryExpensePaymentStatus; label: string }>;
  reviewOutcomes: Array<{ value: HistoryExpenseReviewOutcome; label: string }>;
  actions: {
    manage: boolean;
    verify: boolean;
    confirm: boolean;
    activate: boolean;
    correct: boolean;
  };
}

export type HistoryExpenseScope = string | { companyEntityId: string };

function base(scope: HistoryExpenseScope) {
  return typeof scope === "string"
    ? `/projects/${encodeURIComponent(scope)}/history-expenses`
    : `/company-entities/${encodeURIComponent(scope.companyEntityId)}/history-expenses`;
}

export interface CompanyHistoryExpenseLedger {
  projectId: null;
  companyEntityId: string;
  companyName: string;
  costCents: string;
  paidCents: string;
  outstandingCents: string;
  unknownPaymentCostCents: string;
}

export async function fetchCompanyHistoryExpenseLedger(companyEntityId: string) {
  const response = await apiFetch(`/company-entities/${encodeURIComponent(companyEntityId)}/history-expenses/ledger`, { method: "GET" });
  await ensureOk(response, "读取公司日常历史费用台账失败");
  return response.json() as Promise<CompanyHistoryExpenseLedger>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  let message = `${fallback}：${response.status}`;
  try {
    const detail = await response.json();
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw Object.assign(new Error(message), { status: response.status });
}

async function send<T>(
  scope: HistoryExpenseScope,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body: unknown,
  fallback: string
): Promise<T> {
  const response = await apiFetch(`${base(scope)}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

export function fetchHistoryExpenseCapability(scope: HistoryExpenseScope) {
  return send<HistoryExpenseCapability>(
    scope,
    "/capability",
    "GET",
    undefined,
    "读取历史费用核实入账权限失败"
  );
}

export function precheckHistoryExpenses(
  scope: HistoryExpenseScope,
  rows: HistoryExpenseRowInput[]
) {
  return send<HistoryExpensePrecheckResult>(
    scope,
    "/precheck",
    "POST",
    { rows },
    "历史费用预检失败"
  );
}

export async function downloadHistoryExpenseTemplate(scope: HistoryExpenseScope) {
  const response = await apiFetch(`${base(scope)}/excel-template`, { method: "GET" });
  await ensureOk(response, "下载历史费用导入模板失败");
  return response.blob();
}

export async function precheckHistoryExpenseExcel(scope: HistoryExpenseScope, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch(`${base(scope)}/excel-precheck`, { method: "POST", body: form });
  await ensureOk(response, "预检历史费用 Excel 失败");
  return response.json() as Promise<{
    rows: HistoryExpenseRowInput[];
    worksheetRows: number[];
    precheck: HistoryExpensePrecheckResult;
  }>;
}

export function createHistoryExpenseBatch(
  scope: HistoryExpenseScope,
  rows: HistoryExpenseRowInput[],
  batchNo?: string
) {
  return send<HistoryExpenseBatchReadModel & { idempotent: boolean }>(
    scope,
    "/batches",
    "POST",
    { rows, ...(batchNo ? { batchNo } : {}) },
    "创建历史费用批次失败"
  );
}

export function fetchHistoryExpenseBatches(scope: HistoryExpenseScope) {
  return send<HistoryExpenseBatchListItem[]>(
    scope,
    "/batches",
    "GET",
    undefined,
    "读取历史费用批次失败"
  );
}

export function fetchHistoryExpenseBatch(scope: HistoryExpenseScope, batchId: string) {
  return send<HistoryExpenseBatchReadModel>(
    scope,
    `/batches/${encodeURIComponent(batchId)}`,
    "GET",
    undefined,
    "读取历史费用批次详情失败"
  );
}

export function verifyHistoryExpenseRow(
  scope: HistoryExpenseScope,
  batchId: string,
  rowId: string,
  input: {
    expectedRevision: number;
    reviewOutcome: HistoryExpenseReviewOutcome;
    values?: Record<string, unknown>;
    note?: string;
  }
) {
  return send<HistoryExpenseBatchReadModel>(
    scope,
    `/batches/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}`,
    "PATCH",
    input,
    "保存历史费用核实结果失败"
  );
}

export function correctHistoryExpenseRow(
  scope: HistoryExpenseScope,
  batchId: string,
  rowId: string,
  input: {
    expectedRevision: number;
    reason: string;
    values: Record<string, unknown>;
  }
) {
  return send<HistoryExpenseBatchReadModel>(
    scope,
    `/batches/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}/corrections`,
    "POST",
    input,
    "更正已入账历史费用失败"
  );
}

export function confirmHistoryExpenseBatch(
  scope: HistoryExpenseScope,
  batchId: string,
  input: { expectedRevision: number; idempotencyKey: string; note?: string }
) {
  return send<{
    idempotencyKey: string;
    batchId: string;
    revision: number;
    confirmedAt: string;
  }>(
    scope,
    `/batches/${encodeURIComponent(batchId)}/confirmations`,
    "POST",
    input,
    "提交历史费用主管复核失败"
  );
}

export function activateHistoryExpenseBatch(
  scope: HistoryExpenseScope,
  batchId: string,
  input: { expectedRevision: number }
) {
  return send<HistoryExpenseBatchReadModel>(
    scope,
    `/batches/${encodeURIComponent(batchId)}/activation`,
    "POST",
    input,
    "历史费用核实入账失败"
  );
}

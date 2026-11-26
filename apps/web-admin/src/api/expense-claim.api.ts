import { apiFetch } from "./api-fetch";
import type { BusinessEntrySceneDefinition, GeneralProcurementPaymentCategory } from "@jiangkong/shared-domain";
import { formatApiErrorMessage } from "./error-message";

export type ExpenseClaimWorkbenchView = "all" | "drafts" | "in_progress" | "pending_funds";

export interface ExpenseClaimListItemReadModel {
  id: string;
  code: string;
  claimType: "reimbursement" | "loan" | "incidental_expense";
  incidentalExpenseCategory:
    | "temporary_service"
    | "temporary_machinery_shift"
    | "sporadic_labor"
    | "other_incidental"
    | GeneralProcurementPaymentCategory
    | null;
  status: string;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  companyEntityNameSnapshot: string;
  applicantNameSnapshot: string;
  handledByNameSnapshot: string;
  reason: string;
  requestedAmountCents: string;
  loanOffsetAmountCents: string;
  companyPayableAmountCents: string;
  fundedAmountCents: string;
  updatedAt: string;
}

export interface ExpenseClaimDetailReadModel extends Omit<ExpenseClaimListItemReadModel, "handledByNameSnapshot"> {
  costBearingCompanySpecified?: boolean;
  costBearingCompanyEntityId?: string | null;
  costBearingCompanyName?: string | null;
  bearingCompanyOptions?: ExpenseBearingCompanyOption[];
  actualPurchaseBatchId?: string | null;
  cashCostAllocationOptions?: Array<{ costImpactId: string; lineNumber?: string; description: string | null; availableAmountCents: string }>;
  canDeleteDraft?: boolean;
  approvalInstanceId?: string | null;
  canWithdrawApproval?: boolean;
  canEditReturnedDraft?: boolean;
  returnedDraftEntryDefinition?: BusinessEntrySceneDefinition | null;
  generalProcurement?: { id: string; code: string } | null;
  entrySnapshots: ExpenseClaimEntrySnapshotReadModel[];
  applicantPhoneSnapshot: string | null;
  handledByNameSnapshot: string;
  proxyReason: string | null;
  factWitnessNameSnapshot: string | null;
  paymentMethod: string | null;
  payeeNameSnapshot: string | null;
  payeeAccountNameSnapshot: string | null;
  payeeBankNameSnapshot: string | null;
  payeeBankAccountSnapshot: string | null;
  originalDebtorCompanyId?: string | null;
  paymentSubjectCompanyEntityId: string | null;
  paymentSubjectNameSnapshot: string | null;
  paymentSubjectAdjustmentReason: string | null;
  paymentSubjectAdjustedAt: string | null;
  paymentSubjectAdjustedByUserId: string | null;
  paymentSubjectAdjustedByRoleKey: string | null;
  loanExpectedClearanceAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  lines: Array<{ id: string; sortOrder: number; expenseCategory: string; occurredOn: string; purpose: string; quantity: string | null; receiptCount: number; amountCents: string; evidenceType: string; noEvidenceReason: string | null; remark: string | null }>;
  sourcePurchase: ExpenseClaimSourcePurchase | null;
  attachments: Array<{
    id: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    fileStatus: string;
    category: "invoice" | "receipt_or_other" | "other";
    expenseCategory: string | null;
    stage: "draft" | "approval_frozen" | "post_submit_append";
    attachedByUserId: string;
    attachedByName: string;
    frozenAt: string | null;
    removedAt: string | null;
    createdAt: string;
  }>;
  attachmentPermissions: { canAppendEvidence: boolean };
  paymentSubjectPermissions: { canAdjust: boolean };
  paymentSubjectCompanyEntities: Array<{ id: string; name: string }>;
  fundsPermissions: {
    canRecordPayment: boolean;
    canRecordPublicCashPayment?: boolean;
    canRecordReimbursementPayment: boolean;
    canGenerateFinalPaymentPdf: boolean;
    canGenerateLoanFinalDisbursementPdf: boolean;
    canRecordLoanDisbursement: boolean;
    canRecordLoanRepayment: boolean;
    canConfirmLoanRepayment: boolean;
    canReverseLoanRepayment: boolean;
  };
  paymentExecutions: Array<{
    id: string;
    amountCents: string;
    paidAt: string;
    paymentMethod: string;
    voucherFileId: string;
    recordedByUserId: string;
    note: string | null;
    createdAt: string;
    registeredFunding?: {
      actualPayerCompanyId: string | null;
      actualPayerKind?: "public_cash";
      actualPayerName: string;
      originalDebtorCompanyId: string;
      relationshipEntryId: string | null;
    };
  }>;
  loanAccount: { id: string; fundedAmountCents: string; offsetAmountCents: string; repaidAmountCents: string; reservedOffsetAmountCents: string; balanceAmountCents: string } | null;
  loanDisbursements: Array<{ id: string; amountCents: string; occurredAt: string; paymentMethod: string | null; voucherFileId: string | null; note: string | null }>;
  loanRepayments: Array<{ id: string; amountCents: string; repaidAt: string; paymentMethod: string; voucherFileId: string | null; status: string; confirmationNote: string | null; reversalReason: string | null; createdAt: string }>;
  finalPaymentPdf: { id: string; fileId: string; createdAt: string } | null;
  approval: {
    currentNodeName: string;
    canReview: boolean;
    requiresSelfReviewConfirmation: boolean;
    approvalInstanceId?: string;
    actionableDuties?: Array<{ index: number; name: string }>;
  } | null;
}

export interface ExpenseClaimSourcePurchase {
  batchId: string;
  kind: "spot_material" | "general";
  supplierName: string;
  status: string;
  totalAmountCents: string;
  effectiveTotalAmountCents: string;
  costConfirmed: boolean;
  costConfirmedAt: string | null;
  procurementId: string;
  procurementCode: string | null;
  categoryLabel: string | null;
  projectId: string | null;
  companyEntityId: string | null;
  attachments: Array<{
    fileId: string;
    category: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    fileStatus: string;
  }>;
}

export interface ExpenseCategoryOption {
  name: string;
  isDefault: boolean;
  usageCount: number;
}

export interface SelectablePurchaseBatch {
  batchId: string;
  kind: "spot_material" | "general";
  supplierName: string;
  status: string;
  totalAmountCents: string;
  effectiveTotalAmountCents: string;
  availableAmountCents: string;
  costConfirmed: boolean;
  procurementId: string;
  procurementCode: string | null;
  categoryLabel: string | null;
}

export interface ExpenseClaimEntrySnapshotReadModel {
  id: string;
  frozenAt: string;
  definitionSnapshot: BusinessEntrySceneDefinition;
  valuesSnapshot: Record<string, unknown>;
}

export interface ExpenseBearingCompanyOption {
  projectId: string;
  companyEntityId: string;
  companyNameSnapshot: string;
}

export interface ExpenseClaimCreateOptions {
  entryDefinition: BusinessEntrySceneDefinition;
  companyEntities: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; code: string; name: string }>;
  selfProjectIds: string[];
  bearingCompanyOptions?: ExpenseBearingCompanyOption[];
  selfApplicantUserId: string;
  canProxy: boolean;
  applicantUsers: Array<{ id: string; name: string }>;
  factWitnessUsers: Array<{ id: string; name: string }>;
  expenseCategories: ExpenseCategoryOption[];
  availableActions: string[];
  incidentalExpenseCategories: Array<{
    key:
      | "temporary_service"
      | "temporary_machinery_shift"
      | "sporadic_labor"
      | "other_incidental"
    | GeneralProcurementPaymentCategory;
    label: string;
  }>;
}

export interface ExpenseClaimActionCapabilityReadModel {
  claimId: string;
  availableActions: string[];
  removableAttachmentIds: string[];
}

export interface CreateExpenseClaimPayload {
  actualPurchaseBatchId?: string;
  generalProcurementId?: string;
  generalProcurementRequestKey?: string;
  claimType: "reimbursement" | "loan" | "incidental_expense";
  incidentalExpenseCategory?:
    | "temporary_service"
    | "temporary_machinery_shift"
    | "sporadic_labor"
    | "other_incidental"
    | GeneralProcurementPaymentCategory;
  companyEntityId: string;
  costBearingCompanyEntityId?: string | null;
  projectId?: string;
  factWitnessUserId?: string;
  applicantUserId?: string;
  applicantName?: string;
  applicantPhone?: string;
  reason: string;
  requestedAmountCents: string;
  paymentMethod?: string;
  payeeName?: string;
  payeeAccountName?: string;
  payeeBankName?: string;
  payeeBankAccount?: string;
  loanExpectedClearanceOn?: string;
  lines?: Array<{
    expenseCategory: string;
    occurredOn: string;
    purpose: string;
    quantity?: string;
    receiptCount: number;
    amountCents: string;
    evidenceType: "invoice" | "receipt_or_other" | "none";
    noEvidenceReason?: string;
    remark?: string;
  }>;
}

export interface CreatedExpenseClaim {
  id: string;
  code: string;
  status: string;
  requestedAmountCents: string;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `读取费用与报销工作台失败：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    const detail = typeof data.message === "string"
      ? data.message
      : Array.isArray(data.message)
        ? data.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, "读取费用与报销工作台失败");
  } catch {
    message = formatApiErrorMessage(message, response.status, "读取费用与报销工作台失败");
  }
  throw Object.assign(new Error(message), { status: response.status });
}

export interface ExpenseClaimLedgerColumn {
  key: string;
  header: string;
  required: boolean;
}

export interface ExpenseClaimLedgerRow {
  id: string;
  code: string;
  claimType: string;
  claimTypeLabel: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  projectId: string | null;
  projectName: string;
  companyName: string;
  applicantName: string;
  handledByName: string;
  reason: string;
  payeeName: string;
  requestedAmountCents: string;
  loanOffsetAmountCents: string;
  companyPayableAmountCents: string;
  fundedAmountCents: string;
  updatedAt: string;
}

export interface ExpenseClaimLedgerQuery {
  view?: ExpenseClaimWorkbenchView;
  page?: number;
  pageSize?: number;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  keyword?: string;
  sort?: string;
  columns?: string;
}

export interface ExpenseClaimLedgerPage {
  rows: ExpenseClaimLedgerRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    drafts: number;
    inProgress: number;
    pendingFunds: number;
    knownAmountRows: number;
  };
  filters: Record<string, string | null>;
  columns: ExpenseClaimLedgerColumn[];
}

export async function fetchExpenseClaimLedger(query: ExpenseClaimLedgerQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const text = String(value).trim();
    if (text === "") continue;
    params.set(key, text);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await apiFetch(`/expense-claims/ledger${suffix}`);
  await ensureOk(response);
  return response.json() as Promise<ExpenseClaimLedgerPage>;
}

export async function downloadExpenseClaimLedger(query: ExpenseClaimLedgerQuery = {}) {
  const params = new URLSearchParams();
  const entries: Array<[string, string | number | undefined]> = [];
  // 只上送业务筛选，未知字段不进入导出请求。
  if (typeof query === "object" && query !== null) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      const text = String(value).trim();
      if (text === "") continue;
      entries.push([key, text]);
    }
  }
  for (const [key, value] of entries) params.set(key, String(value));
  const search = params.toString();
  const response = await apiFetch(
    `/expense-claims/ledger-export${search ? `?${search}` : ""}`
  );
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new Error(
      typeof errorBody.message === "string" && errorBody.message.trim()
        ? errorBody.message
        : "导出${fallback.replace('.xlsx','')}失败"
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/u.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : "${fallback}";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function fetchExpenseClaimExpenseCategories(companyEntityId: string) {
  const response = await apiFetch(
    `/expense-claims/expense-categories?${new URLSearchParams({ companyEntityId }).toString()}`
  );
  await ensureOk(response);
  return response.json() as Promise<{ categories: ExpenseCategoryOption[] }>;
}

export async function fetchExpenseClaimSelectablePurchaseBatches(input: {
  companyEntityId: string;
  projectId?: string;
}) {
  const query = new URLSearchParams({ companyEntityId: input.companyEntityId });
  if (input.projectId) query.set("projectId", input.projectId);
  const response = await apiFetch(
    `/expense-claims/selectable-purchase-batches?${query.toString()}`
  );
  await ensureOk(response);
  return response.json() as Promise<{ batches: SelectablePurchaseBatch[] }>;
}

export async function fetchExpenseClaimCreateOptions() {
  const response = await apiFetch("/expense-claims/create-options");
  await ensureOk(response);
  return response.json() as Promise<ExpenseClaimCreateOptions>;
}

export async function createExpenseClaim(payload: CreateExpenseClaimPayload) {
  const response = await apiFetch("/expense-claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await ensureOk(response);
  return response.json() as Promise<CreatedExpenseClaim>;
}

export async function submitExpenseClaim(claimId: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/submission`, { method: "POST" });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; status: string; submittedAt: string; approvalInstanceId?: string }>;
}

export interface EditReturnedExpenseClaimDraftInput {
  expectedUpdatedAt: string;
  reason: string;
  costBearingCompanyEntityId?: string | null;
  lines?: CreateExpenseClaimPayload["lines"];
  requestedAmountCents?: string;
}

export async function withdrawExpenseClaim(claimId: string, approvalInstanceId: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/withdrawal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalInstanceId })
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; status: string }>;
}

export async function editReturnedExpenseClaimDraft(claimId: string, body: EditReturnedExpenseClaimDraftInput) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/draft`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; status: string; updatedAt: string; requestedAmountCents: string }>;
}

export async function reviewExpenseClaim(claimId: string, body: {
  decision: "approve" | "reject";
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
  approvalInstanceId?: string;
  approvalDutyIndex?: number;
}) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; status: string; completed?: boolean }>;
}

export async function attachExpenseClaimAttachment(
  claimId: string,
  body: { fileId: string; category: "invoice" | "receipt_or_other" | "other"; expenseCategory?: string }
) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string }>;
}

export async function appendExpenseClaimAttachment(
  claimId: string,
  body: { fileId: string; category: "invoice" | "receipt_or_other" | "other"; expenseCategory?: string }
) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/attachments/append`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string }>;
}

export async function removeExpenseClaimAttachment(claimId: string, attachmentId: string, reason?: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/attachments/${encodeURIComponent(attachmentId)}/removal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {})
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string }>;
}

export async function fetchExpenseClaimDetail(claimId: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}`);
  await ensureOk(response);
  return response.json() as Promise<ExpenseClaimDetailReadModel>;
}

export async function fetchExpenseClaimActionCapability(claimId: string, funding?: { scopeKey?: string }) {
  const scopeQuery = funding?.scopeKey === "public_cash" ? "?scopeKey=public_cash" : "";
  const response = await apiFetch(
    `/expense-claims/${encodeURIComponent(claimId)}/capability${scopeQuery}`
  );
  await ensureOk(response);
  return response.json() as Promise<ExpenseClaimActionCapabilityReadModel>;
}

async function uploadExpenseClaimPrivateFile(
  path: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  const response = await apiFetch(path, { method: "POST", body: form });
  await ensureOk(response);
  return response.json() as Promise<{ id: string }>;
}

export function uploadExpenseClaimDraftAttachmentFile(
  claimId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadExpenseClaimPrivateFile(
    `/expense-claims/${encodeURIComponent(claimId)}/draft-attachment-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadExpenseClaimAppendAttachmentFile(
  claimId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadExpenseClaimPrivateFile(
    `/expense-claims/${encodeURIComponent(claimId)}/append-attachment-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadExpenseClaimPaymentVoucherFile(
  claimId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string,
  scopeKey?: string
) {
  const query = scopeKey === "public_cash" ? "?scopeKey=public_cash" : "";
  return uploadExpenseClaimPrivateFile(
    `/expense-claims/${encodeURIComponent(claimId)}/payment-voucher-file-uploads${query}`,
    file,
    fileName,
    idempotencyKey
  );
}

export async function adjustExpenseClaimPaymentSubject(claimId: string, body: { companyEntityId: string; reason: string }) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/payment-subject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{
    id: string;
    paymentSubjectCompanyEntityId: string;
    paymentSubjectNameSnapshot: string;
    paymentSubjectAdjustmentReason: string;
    paymentSubjectAdjustedAt: string;
    paymentSubjectAdjustedByUserId: string;
    paymentSubjectAdjustedByRoleKey: string;
  }>;
}

export interface ExpenseRegisteredFundingInput {
  scopeKey: string;
  expectedRegistrationId: string;
  sourceAllocations: Array<{ sourceBatchId: string; amountCents: string }>;
  costAllocations?: Array<{ costImpactId: string; amountCents: string }>;
}
export interface ExpenseClaimPaymentInput {
  amountCents: string;
  paidAt: string;
  paymentMethod: string;
  voucherFileId: string;
  confirmationPassword: string;
  note?: string;
  registeredFunding?: ExpenseRegisteredFundingInput;
}

export async function recordExpenseClaimPayment(claimId: string, body: ExpenseClaimPaymentInput) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; expenseClaimId: string; paidAmountCents: string; status: string;
    registeredFunding?: { actualPayerCompanyId: string | null; actualPayerKind?: "public_cash"; relationshipEntryId: string | null };
  }>;
}

export async function generateExpenseClaimFinalPaymentPdf(claimId: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/final-payment-pdf`, { method: "POST" });
  await ensureOk(response);
  return response.json() as Promise<{ pdfDocumentId: string; fileId: string; existed: boolean }>;
}

export async function deleteExpenseClaimDraft(claimId: string, expectedUpdatedAt: string) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  if (capability.claimId !== claimId || !capability.availableActions.includes("delete_expense_claim_draft")) throw new Error("当前费用草稿不能删除，请刷新后核对");
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/draft-deletion`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt })
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; deleted: boolean }>;
}

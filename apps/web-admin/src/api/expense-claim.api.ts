import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ExpenseClaimWorkbenchView = "all" | "drafts" | "in_progress" | "pending_funds";

export interface ExpenseClaimListItemReadModel {
  id: string;
  code: string;
  claimType: "reimbursement" | "loan";
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
  applicantPhoneSnapshot: string | null;
  handledByNameSnapshot: string;
  proxyReason: string | null;
  factWitnessNameSnapshot: string | null;
  paymentMethod: string | null;
  payeeNameSnapshot: string | null;
  payeeAccountNameSnapshot: string | null;
  payeeBankNameSnapshot: string | null;
  payeeBankAccountSnapshot: string | null;
  paymentSubjectCompanyEntityId: string | null;
  paymentSubjectNameSnapshot: string | null;
  paymentSubjectAdjustmentReason: string | null;
  paymentSubjectAdjustedAt: string | null;
  paymentSubjectAdjustedByUserId: string | null;
  paymentSubjectAdjustedByRoleKey: string | null;
  loanExpectedClearanceAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  lines: Array<{ id: string; sortOrder: number; expenseCategory: string; occurredOn: string; purpose: string; receiptCount: number; amountCents: string; evidenceType: string; noEvidenceReason: string | null; remark: string | null }>;
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
  }>;
  finalPaymentPdf: { id: string; fileId: string; createdAt: string } | null;
  approval: { currentNodeName: string; canReview: boolean; requiresSelfReviewConfirmation: boolean } | null;
}

export interface ExpenseClaimCreateOptions {
  companyEntities: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; code: string; name: string }>;
  canProxy: boolean;
  applicantUsers: Array<{ id: string; name: string }>;
  factWitnessUsers: Array<{ id: string; name: string }>;
}

export interface CreateExpenseClaimPayload {
  claimType: "reimbursement" | "loan";
  companyEntityId: string;
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
  throw new Error(message);
}

export async function fetchExpenseClaims(view: ExpenseClaimWorkbenchView = "all") {
  const query = view === "all" ? "" : `?${new URLSearchParams({ view }).toString()}`;
  const response = await apiFetch(`/expense-claims${query}`);
  await ensureOk(response);
  return response.json() as Promise<ExpenseClaimListItemReadModel[]>;
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
  return response.json() as Promise<{ id: string; status: string; submittedAt: string }>;
}

export async function reviewExpenseClaim(claimId: string, body: { decision: "approve" | "reject"; comment?: string; selfReviewReason?: string; confirmationPassword?: string }) {
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

export async function recordExpenseClaimPayment(claimId: string, body: { amountCents: string; paidAt: string; paymentMethod: string; voucherFileId: string; confirmationPassword: string; note?: string }) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response);
  return response.json() as Promise<{ id: string; expenseClaimId: string; paidAmountCents: string; status: string }>;
}

export async function generateExpenseClaimFinalPaymentPdf(claimId: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/final-payment-pdf`, { method: "POST" });
  await ensureOk(response);
  return response.json() as Promise<{ pdfDocumentId: string; fileId: string; existed: boolean }>;
}

export async function generateExpenseClaimFinalDisbursementPdf(claimId: string) {
  const response = await apiFetch(`/expense-claims/${encodeURIComponent(claimId)}/final-disbursement-pdf`, { method: "POST" });
  await ensureOk(response);
  return response.json() as Promise<{ pdfDocumentId: string; fileId: string; existed: boolean }>;
}

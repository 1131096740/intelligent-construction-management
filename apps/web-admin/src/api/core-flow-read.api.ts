import type {
  ContractDetailReadModel,
  PaymentDetailReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = data.message;
    } else if (Array.isArray(data.message)) {
      message = data.message.join("；");
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
  }

  throw new Error(message);
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取失败");
  return response.json() as Promise<T>;
}

async function postJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "提交失败");
  return response.json() as Promise<TResponse>;
}

async function postForm<TResponse>(path: string, body: FormData): Promise<TResponse> {
  const response = await apiFetch(path, { method: "POST", body });
  await ensureOk(response, "上传失败");
  return response.json() as Promise<TResponse>;
}

async function deleteJson<TResponse>(path: string): Promise<TResponse> {
  const response = await apiFetch(path, { method: "DELETE" });
  await ensureOk(response, "删除失败");
  return response.json() as Promise<TResponse>;
}

export function fetchContractDetail(contractId: string) {
  return readJson<ContractDetailReadModel>(`/contracts/${contractId}`);
}

export function fetchSettlementDetail(settlementId: string) {
  return readJson<SettlementDetailReadModel>(`/settlements/${settlementId}`);
}

export function fetchPaymentDetail(paymentId: string) {
  return readJson<PaymentDetailReadModel>(`/payments/${paymentId}`);
}

// 操作人统一来自登录态（access token），写入负载不再携带 *ByUserId。
export interface CreatePaymentTermsStagePayload {
  name: string;
  stageType?: "advance" | "progress" | "final" | "retention" | "other";
  basis:
    | "contract_amount"
    | "current_settlement"
    | "cumulative_settlement"
    | "fixed_amount"
    | "manual_amount";
  ratioBps?: number;
  fixedAmountCents?: number;
  triggerAnchor?: "contract_effective" | "settlement_effective" | "final_settlement_effective";
  triggerEvent: string;
  dueDays: number;
  advanceDeductionMode?: "none" | "per_settlement_ratio" | "after_cumulative_settlement_ratio";
  advanceDeductionRatioBps?: number;
  advanceDeductionStartRatioBps?: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
  retentionBps?: number;
  originalText: string;
}

export interface CreateContractPayload {
  projectId: string;
  code: string;
  name: string;
  counterparty: string;
  companyEntityId?: string;
  amountCents: number;
  paymentTermsOriginalText: string;
  paymentStages: CreatePaymentTermsStagePayload[];
}

export interface CreateContractReadModel {
  contract: { id: string; code: string };
  version: { id: string };
  terms: { id: string };
}

export interface CreateSettlementPayload {
  contractVersionId: string;
  code: string;
  periodLabel: string;
  amountCents: number;
  isFinal?: boolean;
}

export interface CreateSettlementReadModel {
  id: string;
  code: string;
}

export interface CreatePaymentRequestPayload {
  sourceType?: "settlement" | "contract_advance";
  settlementId?: string;
  contractVersionId?: string;
  paymentTermsVersionId?: string;
  code: string;
  requestedAmountCents: number;
}

export interface CreatePaymentRequestReadModel {
  id: string;
  code: string;
}

export interface ReviewPaymentApprovalPayload {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
  comment?: string;
}

export interface ReviewContractApprovalPayload {
  decision: "approve" | "reject";
  comment?: string;
}

export interface SubmitContractApprovalPayload {
  numberRuleId: string;
  formalCodeOverride?: string;
  overrideReason?: string;
}

export interface ContractNumberRuleReadModel {
  id: string;
  name: string;
  pattern: string;
  companyEntityId: string | null;
  projectId: string | null;
  contractTypeKey: string | null;
  nextSequence: number;
  sequenceWidth: number;
  isActive: boolean;
}

export interface ReviewSettlementApprovalPayload {
  decision: "approve" | "reject" | "reject_previous" | "return_to_applicant";
  comment?: string;
}

export interface AssignSettlementApprovalPayload {
  toUserId: string;
}

export interface RecordPaymentExecutionPayload {
  amountCents: number;
  paidAt: string;
  voucherFileId: string;
  confirmationPassword: string;
}

export interface RecordPaymentFinancePayload {
  amountCents: number;
  occurredAt: string;
}

export interface RecordPaymentPdfArchivePayload {
  fileId: string;
  templateKey?: string;
  departmentScope?: string;
}

export interface GeneratePaymentPdfArchivePayload {
  templateKey?: string;
  departmentScope?: string;
}

export interface UploadContractArchiveFilePayload {
  fileId: string;
}

export interface ConfirmContractArchivePayload {
  archiveFileId: string;
  confirmationPassword: string;
}

export interface UploadSettlementArchiveFilePayload {
  fileId: string;
}

export interface ConfirmSettlementArchivePayload {
  archiveFileId: string;
  confirmationPassword: string;
}

export interface PrivateFileReadModel {
  id: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface PrivateFileDownloadTicketReadModel {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
  downloadUrl: string;
}

export type LedgerTone = "default" | "primary" | "warning" | "danger" | "success";

export interface ContractLedgerListReadModel {
  rows: Array<{
    id: string;
    contractNo: string;
    name: string;
    project: string;
    counterparty: string;
    amount: string;
    version: string;
    currentNode: string;
    nodeTone: LedgerTone;
    ownerDepartment: string;
    updatedAt: string;
    paymentTermsVersion?: string;
  }>;
  summary: {
    total: number;
    inApproval: number;
    pendingSeal: number;
    pendingArchive: number;
    effective: number;
  };
}

export interface SettlementLedgerListReadModel {
  rows: Array<{
    id: string;
    settlementNo: string;
    contractNo: string;
    project: string;
    period: string;
    amount: string;
    paymentTermsVersion: string;
    currentNode: string;
    nodeTone: LedgerTone;
    ownerDepartment: string;
    updatedAt: string;
  }>;
  summary: {
    total: number;
    inApproval: number;
    pendingArchive: number;
    effective: number;
    payable: number;
  };
}

export interface PaymentLedgerListReadModel {
  rows: Array<{
    id: string;
    paymentNo: string;
    settlementNo: string;
    project: string;
    requestedAmount: string;
    approvalStatus: string;
    approvalTone: LedgerTone;
    paymentStatus: string;
    paymentTone: LedgerTone;
    currentNode: string;
    ownerDepartment: string;
    updatedAt: string;
  }>;
  summary: {
    total: number;
    pendingApproval: number;
    orSign: number;
    pendingPayment: number;
    paid: number;
  };
}

export interface AuditLogListReadModel {
  rows: Array<{
    id: string;
    occurredAt: string;
    actor: string;
    action: string;
    actionTone: LedgerTone;
    businessType: string;
    businessTarget: string;
    ipAddress: string;
    resultRisk: string;
    riskTone: LedgerTone;
    trace: string;
  }>;
  summary: {
    total: number;
    login: number;
    approval: number;
    file: number;
    security: number;
  };
}

export interface ArchiveListReadModel {
  rows: Array<{
    id: string;
    documentNo: string;
    documentType: string;
    businessRef: string;
    project: string;
    fileSource: string;
    archiveStatus: string;
    statusTone: Exclude<LedgerTone, "danger">;
    uploadDepartment: string;
    confirmedBy: string;
    lastAction: string;
  }>;
  summary: {
    total: number;
    contractArchives: number;
    settlementArchives: number;
    paymentFiles: number;
    pending: number;
  };
}

export interface ProjectOptionReadModel {
  id: string;
  code: string;
  name: string;
}

export interface ProjectOperatingOverviewReadModel {
  project: ProjectOptionReadModel;
  cash: {
    actualReceiptsCents: number | null;
    availableFundsCents: number | null;
    actualPaidCents: number;
    approvalPendingOccupancyCents: number;
    approvedPendingPaymentCents: number;
    financeRecordedOutflowCents: number;
  };
  business: {
    effectiveContractAmountCents: number;
    effectiveSettlementAmountCents: number;
    payableSettlementAmountCents: number;
    operatingIncomeCents: number | null;
    operatingCostCents: number | null;
    grossProfitCents: number | null;
  };
  counts: {
    contracts: number;
    settlements: number;
    payments: number;
  };
  dataGaps: string[];
}

export interface RecordProjectReceiptPayload {
  receivedAt: string;
  amountCents: number;
  payerName: string;
  sourceType: "general_contractor_payment" | "owner_direct_payment" | "other";
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
}

export interface RecordProjectProxyPaymentPayload {
  paidAt: string;
  amountCents: number;
  generalContractorName: string;
  paidTargetName: string;
  paymentType: "material" | "equipment" | "labor" | "professional_subcontract" | "other";
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
  contractId?: string;
  settlementId?: string;
}

export interface RecordProjectUpstreamSettlementPayload {
  settledAt: string;
  reportedAmountCents: number;
  approvedAmountCents: number;
  approvingPartyName: string;
  periodLabel: string;
  isFinal?: boolean;
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
}

export interface RecordProjectOwnerContractPayload {
  ownerName: string;
  contractName: string;
  contractCode: string;
  signedAt: string;
  amountCents: number;
  taxRateBps: number;
  pricingMethod: string;
  paymentTermsSummary: string;
  retentionSummary: string;
  fileId: string;
}

export interface ConfirmProjectOwnerContractPayload {
  confirmationPassword: string;
}

export interface RequestSettlementExceptionQuotaPayload {
  contractId: string;
  amountCents: number;
  reason: string;
  validUntil: string;
  attachmentFileId: string;
}

export interface ReviewSettlementExceptionQuotaPayload {
  decision: "approve" | "reject";
  confirmationPassword: string;
  comment?: string;
}

export interface RequestProjectFinancingQuotaPayload {
  amountCents: number;
  reason: string;
  validUntil: string;
  attachmentFileId: string;
}

export interface ReviewProjectFinancingQuotaPayload {
  decision: "approve" | "reject";
  confirmationPassword: string;
  comment?: string;
}

export type ProjectExpenseType = "sporadic_payment" | "loan_reserve";

export type ProjectExpenseSubtype =
  | "sporadic_material"
  | "sporadic_machinery"
  | "sporadic_labor"
  | "temporary_service"
  | "other_sporadic"
  | "employee_loan"
  | "owner_loan"
  | "project_reserve";

export type ProjectExpensePaymentMethod =
  | "cash"
  | "wechat"
  | "alipay"
  | "bank_transfer"
  | "other";

export interface CreateProjectExpenseRequestPayload {
  code: string;
  expenseType: ProjectExpenseType;
  expenseSubtype: ProjectExpenseSubtype;
  paymentSubject: string;
  reason: string;
  requestedAmountCents: number;
  paymentMethod: ProjectExpensePaymentMethod;
  counterpartyName?: string;
  counterpartyAccountName?: string;
  counterpartyBankName?: string;
  counterpartyBankAccount?: string;
  handlerUserId?: string;
  attachmentFileId?: string;
}

export interface ReviewProjectExpenseApprovalPayload {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
  comment?: string;
}

export interface VoidProjectExpenseRequestPayload {
  reason: string;
}

export interface RecordProjectExpenseExecutionPayload {
  amountCents: number;
  paidAt: string;
  voucherFileId: string;
  confirmationPassword: string;
}

export interface RecordProjectExpenseFinancePayload {
  amountCents: number;
  occurredAt: string;
}

export interface ProjectExpenseRequestListReadModel {
  rows: Array<{
    id: string;
    code: string;
    expenseType: ProjectExpenseType;
    expenseSubtype: ProjectExpenseSubtype;
    paymentSubject: string;
    reason: string;
    requestedAmountCents: number;
    approvedAmountCents: number | null;
    paidAmountCents: number;
    paymentMethod: ProjectExpensePaymentMethod;
    counterpartyName: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  summary: {
    total: number;
    approvalPending: number;
    approvedPendingPayment: number;
    paid: number;
    paymentBlocked: number;
    totalRequestedCents: number;
    totalPaidCents: number;
  };
}

export function fetchProjects() {
  return readJson<ProjectOptionReadModel[]>("/projects");
}

export function fetchProjectOperatingOverview(projectId: string) {
  return readJson<ProjectOperatingOverviewReadModel>(`/projects/${projectId}/operating-funds-overview`);
}

export function fetchProjectExpenseRequests(projectId: string) {
  return readJson<ProjectExpenseRequestListReadModel>(`/projects/${projectId}/expense-requests`);
}

export function recordProjectReceipt(projectId: string, body: RecordProjectReceiptPayload) {
  return postJson<unknown>(`/projects/${projectId}/receipts`, body);
}

export function recordProjectProxyPayment(projectId: string, body: RecordProjectProxyPaymentPayload) {
  return postJson<unknown>(`/projects/${projectId}/proxy-payments`, body);
}

export function recordProjectUpstreamSettlement(
  projectId: string,
  body: RecordProjectUpstreamSettlementPayload
) {
  return postJson<unknown>(`/projects/${projectId}/upstream-settlements`, body);
}

export function recordProjectOwnerContract(projectId: string, body: RecordProjectOwnerContractPayload) {
  return postJson<unknown>(`/projects/${projectId}/owner-contracts`, body);
}

export function confirmProjectOwnerContract(
  projectId: string,
  ownerContractId: string,
  body: ConfirmProjectOwnerContractPayload
) {
  return postJson<unknown>(`/projects/${projectId}/owner-contracts/${ownerContractId}/confirmation`, body);
}

export function requestSettlementExceptionQuota(
  projectId: string,
  body: RequestSettlementExceptionQuotaPayload
) {
  return postJson<unknown>(`/projects/${projectId}/settlement-exception-quotas`, body);
}

export function reviewSettlementExceptionQuota(
  projectId: string,
  quotaId: string,
  body: ReviewSettlementExceptionQuotaPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/settlement-exception-quotas/${quotaId}/approval`,
    body
  );
}

export function requestProjectFinancingQuota(
  projectId: string,
  body: RequestProjectFinancingQuotaPayload
) {
  return postJson<unknown>(`/projects/${projectId}/financing-quotas`, body);
}

export function reviewProjectFinancingQuota(
  projectId: string,
  quotaId: string,
  body: ReviewProjectFinancingQuotaPayload
) {
  return postJson<unknown>(`/projects/${projectId}/financing-quotas/${quotaId}/approval`, body);
}

export function createProjectExpenseRequest(
  projectId: string,
  body: CreateProjectExpenseRequestPayload
) {
  return postJson<unknown>(`/projects/${projectId}/expense-requests`, body);
}

export function reviewProjectExpenseApproval(
  projectId: string,
  expenseRequestId: string,
  body: ReviewProjectExpenseApprovalPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/approval`,
    body
  );
}

export function withdrawProjectExpenseApproval(projectId: string, expenseRequestId: string) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/approval-withdrawal`
  );
}

export function voidProjectExpenseRequest(
  projectId: string,
  expenseRequestId: string,
  body: VoidProjectExpenseRequestPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/voiding`,
    body
  );
}

export function recordProjectExpenseExecution(
  projectId: string,
  expenseRequestId: string,
  body: RecordProjectExpenseExecutionPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/executions`,
    body
  );
}

export function recordProjectExpenseFinance(
  projectId: string,
  expenseRequestId: string,
  body: RecordProjectExpenseFinancePayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/finance-records`,
    body
  );
}

export function fetchContractLedger() {
  return readJson<ContractLedgerListReadModel>("/contracts");
}

export function fetchSettlementLedger() {
  return readJson<SettlementLedgerListReadModel>("/settlements");
}

export function fetchPaymentLedger() {
  return readJson<PaymentLedgerListReadModel>("/payments");
}

export function fetchAuditLogs() {
  return readJson<AuditLogListReadModel>("/audit-logs");
}

export function fetchArchives() {
  return readJson<ArchiveListReadModel>("/archives");
}

export function uploadPrivateFile(file: Blob, fileName: string) {
  const form = new FormData();
  form.append("file", file, fileName);

  return postForm<PrivateFileReadModel>("/files", form);
}

export interface CreatePrivateFileDownloadTicketPayload {
  confirmationPassword: string;
}

export function createPrivateFileDownloadTicket(
  fileId: string,
  body: CreatePrivateFileDownloadTicketPayload
) {
  return postJson<PrivateFileDownloadTicketReadModel>(`/files/${fileId}/download-ticket`, body);
}

export function createContractDraft(body: CreateContractPayload) {
  return postJson<CreateContractReadModel>("/contracts", body);
}

export function createSettlementDraft(body: CreateSettlementPayload) {
  return postJson<CreateSettlementReadModel>("/settlements", body);
}

export function createPaymentRequest(body: CreatePaymentRequestPayload) {
  return postJson<CreatePaymentRequestReadModel>("/payments", body);
}

export function uploadContractArchiveFile(
  contractVersionId: string,
  body: UploadContractArchiveFilePayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/archive-files`, body);
}

export function confirmContractArchive(
  contractVersionId: string,
  body: ConfirmContractArchivePayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/archive-confirmation`, body);
}

export function fetchActiveContractNumberRules() {
  return readJson<ContractNumberRuleReadModel[]>("/contract-number-rules");
}

export function submitContractApproval(
  contractVersionId: string,
  body: SubmitContractApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-submission`, body);
}

export function reviewContractApproval(
  contractVersionId: string,
  body: ReviewContractApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval`, body);
}

export function withdrawContractApproval(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-withdrawal`);
}

export function remindContractApproval(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-reminder`);
}

export function transferContractApproval(
  contractVersionId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-transfer`, body);
}

export function delegateContractApproval(
  contractVersionId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-delegation`, body);
}

export function approveContractSeal(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/seal-approval`);
}

export function uploadSettlementArchiveFile(
  settlementId: string,
  body: UploadSettlementArchiveFilePayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/archive-files`, body);
}

export function confirmSettlementArchive(
  settlementId: string,
  body: ConfirmSettlementArchivePayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/archive-confirmation`, body);
}

export function reviewSettlementApproval(
  settlementId: string,
  body: ReviewSettlementApprovalPayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/approval`, body);
}

export function withdrawSettlementApproval(settlementId: string) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-withdrawal`);
}

export function remindSettlementApproval(settlementId: string) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-reminder`);
}

export function transferSettlementApproval(
  settlementId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-transfer`, body);
}

export function delegateSettlementApproval(
  settlementId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-delegation`, body);
}

export function reviewPaymentApproval(paymentId: string, body: ReviewPaymentApprovalPayload) {
  return postJson<unknown>(`/payments/${paymentId}/approval`, body);
}

export function withdrawPaymentApproval(paymentId: string) {
  return postJson<unknown>(`/payments/${paymentId}/approval-withdrawal`);
}

export function remindPaymentApproval(paymentId: string) {
  return postJson<unknown>(`/payments/${paymentId}/approval-reminder`);
}

export function transferPaymentApproval(paymentId: string, body: AssignSettlementApprovalPayload) {
  return postJson<unknown>(`/payments/${paymentId}/approval-transfer`, body);
}

export function delegatePaymentApproval(paymentId: string, body: AssignSettlementApprovalPayload) {
  return postJson<unknown>(`/payments/${paymentId}/approval-delegation`, body);
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// 审批单 PDF 下载：审批通过后后端按下载人动态生成带水印 PDF，直接以 blob 触发浏览器下载。
// businessType：合同 contract_version + contractVersionId、结算 settlement + settlementId、付款 payment_request + paymentId。
export async function downloadApprovalForm(businessType: string, businessId: string): Promise<void> {
  const response = await apiFetch(`/approval-forms/${businessType}/${businessId}/download`);
  await ensureOk(response, "下载审批单失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : `审批单-${businessId}.pdf`;
  saveBlob(blob, fileName);
}

export interface CompanyEntityReadModel {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
}

export function fetchCompanyEntities() {
  return readJson<CompanyEntityReadModel[]>("/company-entities");
}

export function createCompanyEntity(body: { name: string; unifiedSocialCreditCode?: string }) {
  return postJson<CompanyEntityReadModel>("/company-entities", body);
}

// 个人签名图：预上传后审批单渲染时复用。
export function uploadSignature(file: Blob, fileName: string) {
  const form = new FormData();
  form.append("file", file, fileName);
  return postForm<{ signatureFileId: string }>("/me/signature", form);
}

export function getSignatureTicket() {
  return readJson<PrivateFileDownloadTicketReadModel | null>("/me/signature/ticket");
}

export function recordPaymentExecution(paymentId: string, body: RecordPaymentExecutionPayload) {
  return postJson<unknown>(`/payments/${paymentId}/executions`, body);
}

export function recordPaymentFinance(paymentId: string, body: RecordPaymentFinancePayload) {
  return postJson<unknown>(`/payments/${paymentId}/finance-records`, body);
}

export function recordPaymentPdfArchive(paymentId: string, body: RecordPaymentPdfArchivePayload) {
  return postJson<unknown>(`/payments/${paymentId}/pdf-archive`, body);
}

export function generatePaymentPdfArchive(
  paymentId: string,
  body: GeneratePaymentPdfArchivePayload = {}
) {
  return postJson<unknown>(`/payments/${paymentId}/pdf-generation`, body);
}

export function generateContractPdfArchive(
  contractVersionId: string,
  body: GeneratePaymentPdfArchivePayload = {}
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/pdf-generation`, body);
}

export function generateSettlementPdfArchive(
  settlementId: string,
  body: GeneratePaymentPdfArchivePayload = {}
) {
  return postJson<unknown>(`/settlements/${settlementId}/pdf-generation`, body);
}

export interface ApprovalDelegationReadModel {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  createdAt: string;
}

export interface CreateApprovalDelegationPayload {
  toUserId: string;
  startsAt: string;
  endsAt: string;
}

export function listApprovalDelegations() {
  return readJson<ApprovalDelegationReadModel[]>("/approval-delegations");
}

export function createApprovalDelegation(body: CreateApprovalDelegationPayload) {
  return postJson<ApprovalDelegationReadModel>("/approval-delegations", body);
}

export function revokeApprovalDelegation(delegationId: string) {
  return deleteJson<ApprovalDelegationReadModel>(`/approval-delegations/${delegationId}`);
}

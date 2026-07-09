import type {
  ContractBusinessOptionReadModel,
  ContractDetailReadModel,
  ContractPaymentApplicationPreviewReadModel,
  PaymentDetailReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
    message = formatApiErrorMessage(message, response.status, fallback);
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

async function patchJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PATCH",
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

export function fetchContractPaymentApplication(contractVersionId: string) {
  const encodedContractVersionId = encodeURIComponent(contractVersionId);
  return readJson<ContractPaymentApplicationPreviewReadModel>(
    `/payments/contract-application?contractVersionId=${encodedContractVersionId}`
  );
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

export type ContractTakeoverLevel = "A" | "B" | "C";

export type ContractLifecycleStatus =
  | "signed_not_started"
  | "in_progress"
  | "suspended"
  | "completed"
  | "terminated"
  | "disputed";

export type ContractTakeoverStatus =
  | "draft"
  | "pending_review"
  | "confirmed"
  | "needs_supplement"
  | "voided";

export type ContractTakeoverCentsValue = number | string;
export type ContractTakeoverEvidencePurpose =
  | "historical_contract_scan"
  | "historical_settlement_ledger"
  | "historical_payment_voucher"
  | "other";

export interface ContractTakeoverEvidenceFileReadModel {
  recordId: string;
  fileId: string;
  fileName: string;
  purpose: ContractTakeoverEvidencePurpose;
  purposeLabel: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: string;
  canDownload: boolean;
  disabledReason: string | null;
}

export interface ContractTakeoverEvidenceChecklistItemReadModel {
  purpose: ContractTakeoverEvidencePurpose;
  purposeLabel: string;
  required: boolean;
  uploaded: boolean;
  statusLabel: string;
  riskText: string;
}

export interface ContractTakeoverCorrectionReadModel {
  id: string;
  correctionType: string;
  correctionTypeLabel: string;
  reason: string;
  beforeSummary: string;
  afterSummary: string;
  responsibleUserName: string;
  createdByName: string;
  attachmentFileId: string;
  attachmentFileName: string;
  createdAt: string;
}

export interface ContractTakeoverPostConfirmationVerificationReadModel {
  statusLabel: string;
  summaryText: string;
  newSettlementCount: number;
  paymentRequestCount: number;
  paymentExecutionCount: number;
  financeRecordCount: number;
}

export interface ContractTakeoverReadModel {
  id: string;
  batchNo: string | null;
  importRowNo: number | null;
  contractNo: string;
  contractName: string;
  counterparty: string;
  companyEntityName: string | null;
  amountCents: ContractTakeoverCentsValue;
  paymentTermsOriginalText: string;
  takeoverLevel: ContractTakeoverLevel;
  levelRiskText: string;
  paymentBlockingHint: string;
  evidenceGapSummary: string;
  takeoverStatus: ContractTakeoverStatus;
  lifecycleStatus: ContractLifecycleStatus;
  signedAt: string;
  historicalSettledCents: ContractTakeoverCentsValue;
  historicalApprovalPendingPaymentCents: ContractTakeoverCentsValue;
  historicalApprovedPendingPaymentCents: ContractTakeoverCentsValue;
  historicalPaidCents: ContractTakeoverCentsValue;
  historicalProxyPaidCents: ContractTakeoverCentsValue;
  historicalAdvancePaidCents: ContractTakeoverCentsValue;
  historicalAdvanceDeductedCents: ContractTakeoverCentsValue;
  historicalRetentionWithheldCents: ContractTakeoverCentsValue;
  historicalRetentionReleasedCents: ContractTakeoverCentsValue;
  otherConfirmedOccupancyCents: ContractTakeoverCentsValue;
  balanceSourceSummary: string | null;
  evidenceSummary: string | null;
  takeoverCutoffDate: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  reviewComment: string | null;
  acceptanceConclusion: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  historicalBalanceConfirmedAt: string | null;
  evidenceChecklist: ContractTakeoverEvidenceChecklistItemReadModel[];
  evidenceFiles: ContractTakeoverEvidenceFileReadModel[];
  corrections: ContractTakeoverCorrectionReadModel[];
  postConfirmationVerification: ContractTakeoverPostConfirmationVerificationReadModel;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContractTakeoverPayload {
  code: string;
  name: string;
  counterparty: string;
  contractTypeKey?: string;
  companyEntityId?: string;
  companyEntityName?: string;
  amountCents: number;
  signedAt: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText?: string;
  historicalSettledCents?: number;
  historicalApprovalPendingPaymentCents?: number;
  historicalApprovedPendingPaymentCents?: number;
  historicalPaidCents?: number;
  historicalProxyPaidCents?: number;
  historicalAdvancePaidCents?: number;
  historicalAdvanceDeductedCents?: number;
  historicalRetentionWithheldCents?: number;
  historicalRetentionReleasedCents?: number;
  otherConfirmedOccupancyCents?: number;
  balanceSourceSummary?: string;
  evidenceSummary?: string;
  takeoverCutoffDate?: string;
  responsibleUserId?: string;
  reviewComment?: string;
  acceptanceConclusion?: string;
  evidenceChecklist?: string;
  issueSummary?: string;
}

export interface PrecheckContractTakeoverImportRowPayload extends Record<string, unknown> {
  rowNo?: number;
}

export interface PrecheckContractTakeoverImportPayload {
  rows: PrecheckContractTakeoverImportRowPayload[];
  batchNo?: string;
  takeoverCutoffDate?: string;
  responsibleUserId?: string;
  reviewComment?: string;
  acceptanceConclusion?: string;
}

export type ContractTakeoverImportBatchReviewStatus =
  | "under_review"
  | "accepted"
  | "limited_accepted"
  | "disputed";

export interface ReviewContractTakeoverImportBatchPayload {
  status: ContractTakeoverImportBatchReviewStatus;
  reviewComment: string;
  acceptanceConclusion: string;
}

export interface ContractTakeoverImportBatchReadModel {
  id: string;
  batchNo: string;
  status: string;
  statusLabel: string;
  riskText: string;
  takeoverCutoffDate: string;
  responsibleUserId: string;
  reviewComment: string;
  acceptanceConclusion: string;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  warningRows: number;
  createdCount: number;
  skippedCount: number;
}

export interface ContractTakeoverImportPrecheckIssueReadModel {
  rowNo: number;
  field: string;
  level: "error" | "warning";
  message: string;
}

export interface ContractTakeoverImportPrecheckRowReadModel {
  rowNo: number;
  code: string;
  name: string;
  counterparty: string;
  amountCents: number | null;
  takeoverLevel: string;
  lifecycleStatus: string;
  evidenceChecklist: string;
  issueSummary: string;
  status: "ready" | "blocked";
  issues: ContractTakeoverImportPrecheckIssueReadModel[];
}

export interface ContractTakeoverImportPrecheckReadModel {
  projectId: string;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  warningRows: number;
  existingCodes: string[];
  duplicatedCodes: string[];
  rows: ContractTakeoverImportPrecheckRowReadModel[];
}

export interface ContractTakeoverImportDraftReadModel {
  projectId: string;
  batch: ContractTakeoverImportBatchReadModel;
  createdCount: number;
  skippedCount: number;
  createdRows: number[];
  created: ContractTakeoverReadModel[];
}

export interface ConfirmContractTakeoverPayload {
  confirmationPassword: string;
}

export interface AttachContractTakeoverEvidencePayload {
  fileId: string;
  purpose: ContractTakeoverEvidencePurpose;
}

export type ContractTakeoverCorrectionType = "amount" | "payment_terms" | "evidence" | "other";

export interface RecordContractTakeoverCorrectionPayload {
  correctionType: ContractTakeoverCorrectionType;
  reason: string;
  responsibleUserId: string;
  afterSummary: string;
  attachmentFileId: string;
  currentPassword: string;
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
  sourceType?: "settlement" | "contract_advance" | "contract_due";
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
  confirmationPassword: string;
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
    pendingOwner: string;
    stalledFor: string;
    returnReason: string;
    nextAction: string;
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
    pendingOwner: string;
    stalledFor: string;
    returnReason: string;
    nextAction: string;
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
    pendingOwner: string;
    stalledFor: string;
    returnReason: string;
    nextAction: string;
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

export interface FileDownloadAuditListReadModel {
  rows: Array<{
    id: string;
    occurredAt: string;
    actor: string;
    action: string;
    actionKey: "file.download.ticket" | "file.download";
    fileId: string;
    fileName: string;
    businessType: string;
    businessTarget: string;
    downloadReason: string;
    ipAddress: string;
    traceId: string;
    sensitive: string;
  }>;
  summary: {
    total: number;
    ticket: number;
    downloaded: number;
    missingReason: number;
  };
}

export interface ArchiveListReadModel {
  rows: Array<{
    id: string;
    documentNo: string;
    fileId: string;
    documentType: string;
    businessRef: string;
    project: string;
    fileSource: string;
    fileSizeBytes: number;
    canDownload: boolean;
    disabledReason: string | null;
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

export interface ProjectRosterRowReadModel {
  projectId: string;
  projectCode: string;
  projectName: string;
  userId: string;
  name: string;
  phone: string;
  positionNames: string[];
}

export interface CreateProjectPayload {
  code: string;
  name: string;
}

export interface UpdateProjectPayload {
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

export type ProjectExpenseType =
  | "sporadic_payment"
  | "loan_reserve"
  | "comprehensive_expense"
  | "reimbursement"
  | "spot_purchase";

export type ProjectExpenseSubtype =
  | "sporadic_material"
  | "sporadic_machinery"
  | "sporadic_labor"
  | "temporary_service"
  | "other_sporadic"
  | "employee_loan"
  | "owner_loan"
  | "project_reserve"
  | "travel"
  | "entertainment"
  | "reimbursement"
  | "spot_material_purchase"
  | "spot_tool_purchase"
  | "spot_service_purchase"
  | "spot_other_purchase";

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

export interface RecordProjectExpensePurchaseExecutionPayload {
  executedAt: string;
  note?: string;
  confirmationPassword: string;
}

export interface RecordProjectExpenseFinancePayload {
  amountCents: number;
  occurredAt: string;
  confirmationPassword: string;
}

export interface ConfirmProjectExpenseReceiptPayload {
  confirmationPassword: string;
  note?: string;
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
    hasAttachment: boolean;
    hasApprovalPdf: boolean;
    isPurchaseExecuted: boolean;
    isReceiptConfirmed: boolean;
    purchaseExecutedAt: string | null;
    receiptConfirmedAt: string | null;
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

export type WorkbenchCardTone = "default" | "primary" | "warning" | "danger" | "success";

export interface WorkbenchSummaryCardReadModel {
  id: string;
  title: string;
  count: number;
  description: string;
  targetPath: string;
  actionText: string;
  tone: WorkbenchCardTone;
}

export interface WorkbenchSummaryReadModel {
  generatedAt: string;
  visibleProjectCount: number;
  cards: WorkbenchSummaryCardReadModel[];
}

export type WorkItemQueueKey = "pending" | "blocked" | "started";
export type ApprovalCenterViewKey =
  | "pendingApproval"
  | "startedByMe"
  | "handledByMe"
  | "delegatedToMe"
  | "overdueReminder";

export interface WorkItemReadModel {
  id: string;
  type: "contract_takeover" | "archive" | "approval" | "payment_execution" | "blocker";
  title: string;
  projectName: string;
  projectId?: string;
  businessCode: string;
  businessType?: string;
  businessId?: string;
  amountText: string;
  currentNode: string;
  stayedText: string;
  nextAction: string;
  targetPath: string;
  tone: WorkbenchCardTone;
}

export interface WorkItemsReadModel {
  generatedAt: string;
  visibleProjectCount: number;
  queues: Record<WorkItemQueueKey, WorkItemReadModel[]>;
  approvalCenter: Record<ApprovalCenterViewKey, WorkItemReadModel[]>;
}

export function fetchWorkbenchSummary() {
  return readJson<WorkbenchSummaryReadModel>("/me/workbench-summary");
}

export function fetchWorkItems() {
  return readJson<WorkItemsReadModel>("/me/work-items");
}

export function fetchProjects() {
  return readJson<ProjectOptionReadModel[]>("/projects");
}

export function fetchContractCreateProjects() {
  return readJson<ProjectOptionReadModel[]>("/projects/contract-create-options");
}

export function fetchProjectRoster() {
  return readJson<ProjectRosterRowReadModel[]>("/projects/roster");
}

export function createProject(body: CreateProjectPayload) {
  return postJson<ProjectOptionReadModel>("/projects", body);
}

export function updateProject(projectId: string, body: UpdateProjectPayload) {
  return patchJson<ProjectOptionReadModel>(`/projects/${projectId}`, body);
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

export function recordProjectExpensePurchaseExecution(
  projectId: string,
  expenseRequestId: string,
  body: RecordProjectExpensePurchaseExecutionPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/purchase-execution`,
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

export function confirmProjectExpenseReceipt(
  projectId: string,
  expenseRequestId: string,
  body: ConfirmProjectExpenseReceiptPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/receipt-confirmation`,
    body
  );
}

export function downloadProjectExpenseAttachment(
  projectId: string,
  expenseRequestId: string,
  body: CreatePrivateFileDownloadTicketPayload
) {
  return postJson<PrivateFileDownloadTicketReadModel>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/attachment-download-ticket`,
    body
  );
}

export function downloadProjectExpenseApprovalPdf(
  projectId: string,
  expenseRequestId: string,
  body: CreatePrivateFileDownloadTicketPayload
) {
  return postJson<PrivateFileDownloadTicketReadModel>(
    `/projects/${projectId}/expense-requests/${expenseRequestId}/approval-pdf-download-ticket`,
    body
  );
}

export function fetchContractLedger() {
  return readJson<ContractLedgerListReadModel>("/contracts");
}

export function fetchSettlementContractOptions(projectId: string) {
  return readJson<ContractBusinessOptionReadModel[]>(
    `/contracts/settlement-create-options?projectId=${encodeURIComponent(projectId)}`
  );
}

export function fetchPaymentContractOptions(projectId: string) {
  return readJson<ContractBusinessOptionReadModel[]>(
    `/contracts/payment-create-options?projectId=${encodeURIComponent(projectId)}`
  );
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

export function fetchFileDownloadAudits() {
  return readJson<FileDownloadAuditListReadModel>("/audit-logs/file-downloads");
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
  downloadReason: string;
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

export function listContractTakeovers(projectId: string) {
  return readJson<ContractTakeoverReadModel[]>(`/projects/${projectId}/contract-takeovers`);
}

export function listContractTakeoverImportBatches(projectId: string) {
  return readJson<ContractTakeoverImportBatchReadModel[]>(
    `/projects/${projectId}/contract-takeovers/import-batches`
  );
}

export function reviewContractTakeoverImportBatch(
  projectId: string,
  batchId: string,
  body: ReviewContractTakeoverImportBatchPayload
) {
  return patchJson<ContractTakeoverImportBatchReadModel>(
    `/projects/${projectId}/contract-takeovers/import-batches/${batchId}/review-result`,
    body
  );
}

export function getContractTakeover(projectId: string, takeoverId: string) {
  return readJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}`
  );
}

export function createContractTakeover(
  projectId: string,
  body: CreateContractTakeoverPayload
) {
  return postJson<ContractTakeoverReadModel>(`/projects/${projectId}/contract-takeovers`, body);
}

export function updateContractTakeover(
  projectId: string,
  takeoverId: string,
  body: CreateContractTakeoverPayload
) {
  return patchJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}`,
    body
  );
}

export function precheckContractTakeoverImport(
  projectId: string,
  body: PrecheckContractTakeoverImportPayload
) {
  return postJson<ContractTakeoverImportPrecheckReadModel>(
    `/projects/${projectId}/contract-takeovers/import-precheck`,
    body
  );
}

export function createContractTakeoverDraftsFromImport(
  projectId: string,
  body: PrecheckContractTakeoverImportPayload
) {
  return postJson<ContractTakeoverImportDraftReadModel>(
    `/projects/${projectId}/contract-takeovers/import-drafts`,
    body
  );
}

export function attachContractTakeoverEvidenceFile(
  projectId: string,
  takeoverId: string,
  body: AttachContractTakeoverEvidencePayload
) {
  return postJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/evidence-files`,
    body
  );
}

export function recordContractTakeoverCorrection(
  projectId: string,
  takeoverId: string,
  body: RecordContractTakeoverCorrectionPayload
) {
  return postJson<{ id: string; message: string }>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/corrections`,
    body
  );
}

export function submitContractTakeoverReview(projectId: string, takeoverId: string) {
  return postJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/review-submission`
  );
}

export function confirmContractTakeover(
  projectId: string,
  takeoverId: string,
  body: ConfirmContractTakeoverPayload
) {
  return postJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/confirmation`,
    body
  );
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

// 审批单文件下载：审批通过后后端按下载人动态生成带水印文件，直接以 blob 触发浏览器下载。
// businessType：合同 contract_version + contractVersionId、结算 settlement + settlementId、付款 payment_request + paymentId。
export async function downloadApprovalForm(
  businessType: string,
  businessId: string,
  body: CreatePrivateFileDownloadTicketPayload
): Promise<void> {
  const response = await apiFetch(`/approval-forms/${businessType}/${businessId}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "下载审批单失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : `审批单-${businessId}.pdf`;
  saveBlob(blob, fileName);
}

export async function downloadSettlementDraftExcel(settlementId: string): Promise<void> {
  const response = await apiFetch(`/settlements/${settlementId}/draft-excel`);
  await ensureOk(response, "下载结算草稿表格失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : `${settlementId}-结算单-草稿.xlsx`;
  saveBlob(blob, fileName);
}

export async function downloadSettlementAttachmentTemplate(
  settlementId: string,
  templateKey: string
): Promise<void> {
  const response = await apiFetch(
    `/settlements/${settlementId}/attachment-templates/${templateKey}/download`
  );
  await ensureOk(response, "下载结算附件模板失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : `${templateKey}-结算附件模板.xlsx`;
  saveBlob(blob, fileName);
}

export async function downloadSettlementLatestApprovalPdf(
  settlementId: string,
  body: CreatePrivateFileDownloadTicketPayload
): Promise<void> {
  const response = await apiFetch(`/settlements/${settlementId}/approval-pdf/latest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "下载结算审批PDF失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : `${settlementId}-结算审批最新.pdf`;
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
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  createdAt: string;
}

export interface UserOptionReadModel {
  id: string;
  name: string;
}

export interface CreateApprovalDelegationPayload {
  toUserId: string;
  startsAt: string;
  endsAt: string;
}

export function listApprovalDelegations() {
  return readJson<ApprovalDelegationReadModel[]>("/approval-delegations");
}

export function fetchApprovalDelegationUserOptions() {
  return readJson<UserOptionReadModel[]>("/approval-delegations/user-options");
}

export function createApprovalDelegation(body: CreateApprovalDelegationPayload) {
  return postJson<ApprovalDelegationReadModel>("/approval-delegations", body);
}

export function revokeApprovalDelegation(delegationId: string) {
  return deleteJson<ApprovalDelegationReadModel>(`/approval-delegations/${delegationId}`);
}

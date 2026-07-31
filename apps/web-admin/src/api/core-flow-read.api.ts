import type {
  ContractBusinessOptionReadModel,
  ContractWorkbenchLedgerPage,
  ContractWorkbenchView,
  ContractDetailReadModel,
  ContractPaymentApplicationPreviewReadModel,
  DetailActionReadModel,
  DraftLedgerView,
  SettlementWorkbenchLedgerPage,
  SettlementWorkbenchView,
  LifecycleLedgerPage,
  LifecycleLedgerPageMeta,
  LifecycleLedgerViewCount,
  PaymentDetailReadModel,
  ProjectExpenseApprovalDetailReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import type { SettlementLineDraftPayload } from "./settlement-workbench.api";
import type { SettlementSignedDocumentRecordReadModel } from "./settlement-drafts.api";
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

async function putJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "保存失败");
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

export interface ContractChangeVersionProjection {
  id: string;
  contractId: string;
  versionNo: number;
  changeType: string;
  status: string;
  amountCents: string;
  baseVersionId: string | null;
  supersedesVersionId: string | null;
  changeReason: string | null;
  changeDirection: string | null;
  changeAmountCents: string | null;
  originalBaseAmountCents: string | null;
  cumulativeIncreaseCents: string;
  cumulativeDecreaseCents: string;
  amountLimitType: "capped" | "unlimited";
  enhancedApproval: boolean;
  enhancedApprovalReasons: string[];
  approvalRoute: Array<{ name: string; mode: string; roleKeys: string[] }>;
}

export interface ContractChangeEligibilityReadModel {
  eligible: boolean;
  reason: string | null;
  currentEffective: ContractChangeVersionProjection | null;
  activeChange: ContractChangeVersionProjection | null;
}

export interface CreateContractChangeDraftPayload {
  changeType: "change";
  changeReason: string;
  changeDirection: "increase" | "decrease" | "unchanged";
  changeAmountCents: string;
}

export function fetchContractChangeEligibility(contractVersionId: string) {
  return readJson<ContractChangeEligibilityReadModel>(
    `/contracts/${encodeURIComponent(contractVersionId)}/change-eligibility`
  );
}

export function createContractChangeDraft(
  contractVersionId: string,
  body: CreateContractChangeDraftPayload
) {
  return postJson<ContractChangeVersionProjection>(
    `/contracts/${encodeURIComponent(contractVersionId)}/change-drafts`,
    body
  );
}

export function fetchSettlementDetail(settlementId: string) {
  return readJson<SettlementDetailReadModel>(`/settlements/${settlementId}`);
}

export function fetchPaymentDetail(paymentId: string) {
  return readJson<PaymentLifecycleDetailReadModel>(`/payments/${encodeURIComponent(paymentId)}`);
}

export type PaymentLifecycleDetailReadModel = PaymentDetailReadModel & {
  lifecycleKind: "approval_draft" | "formal_record";
  ledgerView: DraftLedgerView;
  lifecycleUpdatedAt: string | null;
  blockedReasons: string[];
};

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
  fixedAmountCents?: string;
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
  amountCents: string;
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

export type ContractTakeoverCentsValue = string;
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
  status: "submitted" | "confirmed" | "rejected";
  statusLabel: string;
  targetCompanyEntityId: string | null;
  reason: string;
  beforeSummary: string;
  afterSummary: string;
  responsibleUserName: string;
  createdByName: string;
  submittedByName: string;
  submittedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  attachmentFileId: string;
  attachmentFileName: string;
  createdAt: string;
}

export type ContractTakeoverPerformanceStatus =
  | "not_started"
  | "performing"
  | "suspended"
  | "completed"
  | "terminated";

export interface ContractTakeoverContractSideReadModel {
  revision: number;
  financeBasisRevision: number;
  signedAt: string;
  historicalSettledCents: string;
  zeroSettlementDeclared: boolean;
  performanceStatus: ContractTakeoverPerformanceStatus;
  settlementEvidenceSummary: string | null;
  settlementEvidenceFileIds: string[];
  paymentTerms: {
    originalText: string;
    stages: HistoricalTakeoverDirectPaymentStagePayload[];
  };
  contractFacts: {
    contractNo: string;
    contractName: string;
    contractTypeKey: string;
    counterparty: string;
    originalAmountCents: string;
    settlementCutoffDate?: string;
    zeroSettlementDeclared: boolean;
    zeroSettlementBasis?: string;
  };
  confirmedRevision: number | null;
  confirmedByUserName: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface ContractTakeoverHistoricalPaymentReadModel {
  id: string;
  rowKey: string;
  sequenceNo: number;
  amountCents: string;
  paidAt: string;
  payerName: string | null;
  payeeName: string | null;
  bankReference: string | null;
  paymentMethod: string | null;
  note: string | null;
  status: string;
  voucherFileIds: string[];
  allocations: Array<{
    id: string;
    allocationType: string;
    amountCents: string;
    allocationOrder: number;
  }>;
}

export interface ContractTakeoverBalanceReadModel {
  id: string;
  balanceType: "historical_advance" | "abnormal_overpay";
  openingCents: string;
  balanceCents: string;
  revision: number;
  entries: Array<{
    id: string;
    entryKind: string;
    amountCents: string;
    settlementId: string | null;
    historicalPaymentId: string | null;
    correctionId: string | null;
    reversesEntryId: string | null;
    createdAt: string;
  }>;
}

export interface ContractTakeoverFinanceSideReadModel {
  revision: number;
  basedOnContractRevision: number;
  basedOnFinanceBasisRevision: number;
  zeroPaymentDeclared: boolean;
  excessTreatment: "historical_advance" | "abnormal_overpay" | null;
  excessReason: string | null;
  excessEvidenceFileIds: string[];
  payments: ContractTakeoverHistoricalPaymentReadModel[];
  balances: ContractTakeoverBalanceReadModel[];
  confirmedRevision: number | null;
  confirmedContractRevision: number | null;
  confirmedFinanceBasisRevision: number | null;
  confirmedByUserName: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export type ContractTakeoverCorrectionScope =
  | "historical_settlement"
  | "historical_payment"
  | "historical_advance"
  | "abnormal_overpay";

export type ContractTakeoverCorrectionOperation =
  | "correction"
  | "reclassification"
  | "reversal";

export interface ContractTakeoverAppliedCorrectionReadModel {
  id: string;
  schemaVersion: 2;
  correctionScope: ContractTakeoverCorrectionScope;
  correctionOperation: ContractTakeoverCorrectionOperation;
  status: "draft" | "submitted" | "applied" | "rejected";
  targetRevision: number;
  targetBalanceRevision: number | null;
  before: unknown;
  delta: unknown;
  after: unknown;
  reason: string;
  responsibleUserName: string;
  submittedByName: string;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  attachmentFileId: string;
  attachmentFileName: string;
  targetHistoricalPaymentId: string | null;
  targetAllocationId: string | null;
  targetBalanceEntryId: string | null;
}

export interface HistoricalCompanyEntityCandidateReadModel {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
  dataStatus: "complete" | "legacy_incomplete";
  isActive: boolean;
}

export interface ContractTakeoverPostConfirmationVerificationReadModel {
  statusLabel: string;
  summaryText: string;
  newSettlementCount: number;
  paymentRequestCount: number;
  paymentExecutionCount: number;
  financeRecordCount: number;
}

export type ContractInvoiceType = "vat_general" | "vat_special";
export type ContractTaxMode = "single_rate" | "multiple_rate";
export type ContractTaxFactSource =
  | "contract_document"
  | "supplement_evidence"
  | "business_finance_confirmation";

export interface HistoricalPricingItemReadModel {
  billKey: string;
  billName: string;
  rowKey: string;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  estimatedQuantity: string | null;
  taxInclusiveUnitPrice: string | null;
  taxRatePercent: string | null;
  pricingFactStatus: string;
  isProvisional: boolean;
  settlementBasis: string | null;
}

export interface ContractTakeoverReadModel {
  id: string;
  batchNo: string | null;
  importRowNo: number | null;
  contractNo: string;
  contractName: string;
  /** Compatibility aliases used by lifecycle-ledger and batch previews. */
  code?: string;
  name?: string;
  counterparty: string;
  companyEntityId: string | null;
  companyEntityName: string | null;
  contractTypeKey?: string | null;
  amountCents: ContractTakeoverCentsValue;
  paymentTermsOriginalText: string;
  paymentStages?: HistoricalTakeoverDirectPaymentStageReadModel[];
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string | null;
  taxFactStatus: string;
  taxFactSource: ContractTaxFactSource | null;
  taxFactExplanation: string | null;
  taxFactMissingFields: string[];
  pricingItems: HistoricalPricingItemReadModel[];
  takeoverLevel: ContractTakeoverLevel;
  suggestedTakeoverLevel: ContractTakeoverLevel | null;
  takeoverLevelAdjustmentReason: string | null;
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
  changeBaselineConfirmed: boolean;
  originalBaseAmountCents: ContractTakeoverCentsValue | null;
  preTakeoverPositiveIncreaseCents: ContractTakeoverCentsValue | null;
  evidenceChecklist: ContractTakeoverEvidenceChecklistItemReadModel[];
  evidenceFiles: ContractTakeoverEvidenceFileReadModel[];
  corrections: ContractTakeoverCorrectionReadModel[];
  contractSide: ContractTakeoverContractSideReadModel | null;
  financeSide: ContractTakeoverFinanceSideReadModel | null;
  appliedCorrections: ContractTakeoverAppliedCorrectionReadModel[];
  postConfirmationVerification: ContractTakeoverPostConfirmationVerificationReadModel;
  lifecycleKind?: "pristine_draft" | "approval_draft" | "formal_record";
  lifecycleBlockers?: string[];
  availableActions?: DetailActionReadModel[];
  createdAt: string;
  updatedAt: string;
}

export interface AbandonContractTakeoverPayload {
  expectedUpdatedAt: string;
  action: "delete_pristine_draft" | "abandon_application";
  reason?: string;
}

export interface AbandonContractTakeoverReadModel {
  takeoverId: string;
  status: "abandoned";
  action?: "delete_pristine_draft" | "abandon_application";
  abandonedAt?: string;
  idempotent: boolean;
}

export interface ContractTakeoverBatchAbandonmentRowReadModel {
  id: string;
  importRowNo: number | null;
  updatedAt: string;
  action: "delete_pristine_draft" | "abandon_application";
  eligible: boolean;
  blockers: string[];
  contractNo: string;
  contractName: string;
}

export interface ContractTakeoverBatchAbandonmentPreviewReadModel {
  batchId: string;
  batchNo: string;
  previewHash: string;
  total: number;
  eligible: number;
  blocked: number;
  rows: ContractTakeoverBatchAbandonmentRowReadModel[];
}

export interface ApplyContractTakeoverBatchAbandonmentPayload {
  previewHash: string;
  reason: string;
}

export interface ApplyContractTakeoverBatchAbandonmentReadModel {
  batchId: string;
  abandonedCount: number;
  previewHash: string;
}

export interface HistoricalTakeoverDirectPaymentStageReadModel {
  id: string;
  name: string;
  ratioBps: number | null;
  fixedAmountCents: ContractTakeoverCentsValue | null;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
}

export interface HistoricalTakeoverDirectPaymentStagePayload {
  name: string;
  ratioBps?: number;
  fixedAmountCents?: string;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
}

export interface HistoricalPricingItemPayload {
  billKey: string;
  billName: string;
  rowKey: string;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  estimatedQuantity?: string;
  taxInclusiveUnitPrice?: string;
  taxRatePercentOverride?: string;
  isProvisional?: boolean;
  settlementBasis?: string;
}

export interface CreateContractTakeoverPayload {
  code: string;
  name: string;
  counterparty: string;
  contractTypeKey?: string;
  companyEntityId?: string;
  companyEntityName?: string;
  invoiceType?: ContractInvoiceType;
  taxMode?: ContractTaxMode;
  defaultTaxRatePercent?: string;
  taxFactSource?: ContractTaxFactSource;
  taxFactExplanation?: string;
  taxFactEvidenceFileId?: string;
  pricingItems?: HistoricalPricingItemPayload[];
  amountCents: string;
  signedAt: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText?: string;
  paymentStages?: HistoricalTakeoverDirectPaymentStagePayload[];
  historicalSettledCents?: string;
  historicalApprovalPendingPaymentCents?: string;
  historicalApprovedPendingPaymentCents?: string;
  historicalPaidCents?: string;
  historicalProxyPaidCents?: string;
  historicalAdvancePaidCents?: string;
  historicalAdvanceDeductedCents?: string;
  historicalRetentionWithheldCents?: string;
  historicalRetentionReleasedCents?: string;
  otherConfirmedOccupancyCents?: string;
  balanceSourceSummary?: string;
  evidenceSummary?: string;
  takeoverCutoffDate?: string;
  responsibleUserId?: string;
  takeoverLevelAdjustmentReason?: string;
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
  responsibleUserName: string | null;
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
  amountCents: string | null;
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

export interface ContractTakeoverExcelIssueReadModel {
  sheet: string;
  row: number;
  column: string;
  message: string;
}

export interface ContractTakeoverExcelPreviewReadModel
  extends ContractTakeoverImportPrecheckReadModel {
  fileId: string;
  fileSha256: string;
  importFingerprint: string;
  errors: ContractTakeoverExcelIssueReadModel[];
}

export interface ApplyContractTakeoverExcelPayload {
  fileId: string;
  fileSha256: string;
  importFingerprint: string;
  takeoverCutoffDate: string;
  responsibleUserId: string;
  reviewComment: string;
  acceptanceConclusion: string;
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

export interface ReturnContractTakeoverForSupplementPayload {
  reason: string;
}

export interface AttachContractTakeoverEvidencePayload {
  fileId: string;
  purpose: ContractTakeoverEvidencePurpose;
}

export interface AttachHistoricalPaymentVoucherPayload {
  fileId: string;
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

export interface SubmitContractTakeoverCompanyEntityCorrectionPayload {
  targetCompanyEntityId: string;
  reason: string;
  responsibleUserId: string;
  attachmentFileId: string;
  currentPassword: string;
}

export interface ReviewContractTakeoverCompanyEntityCorrectionPayload {
  decision: "approve" | "reject";
  comment?: string;
  currentPassword: string;
}

export interface CreateSettlementPayload {
  contractVersionId: string;
  settlementTemplateVersionId: string;
  code: string;
  periodLabel: string;
  amountCents?: string;
  isFinal?: boolean;
  settlementLines?: SettlementLineDraftPayload[];
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
  paymentTermsStageId?: string;
  paymentMatter?: string;
  amountCalculationExplanation?: string;
  code: string;
  requestedAmountCents: string;
}

export interface CreatePaymentRequestReadModel {
  id: string;
  code: string;
}

export interface ReviewPaymentApprovalPayload {
  decision: "approve" | "reject";
  approvedAmountCents?: string;
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface ReviewContractApprovalPayload {
  decision: "approve" | "reject";
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
  ownerContractRiskConfirmed?: boolean;
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
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface AssignSettlementApprovalPayload {
  toUserId: string;
}

export interface RecordPaymentExecutionPayload {
  amountCents: string;
  paidAt: string;
  voucherFileId: string;
  confirmationPassword: string;
}

export interface RecordPaymentFinancePayload {
  amountCents: string;
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
    contractNo: string;
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
    actionKey:
      | "file.download.ticket"
      | "file.download"
      | "approval.form.download"
      | "settlement.approval_pdf.download";
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
  globalPositionNames: string[];
  projectPositionNames: string[];
}

export interface CreateProjectPayload {
  code: string;
  name: string;
}

export interface UpdateProjectPayload {
  name: string;
}

export interface ProjectAffiliateMappingReportReadModel {
  generatedAt: string;
  rows: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    status: "ready" | "missing" | "conflict";
    affiliateName: string | null;
    affiliateCreditCode: string | null;
    businessPartyVersionId: string | null;
    effectiveFrom: string | null;
    currentAssignmentIds: string[];
  }>;
  summary: { ready: number; missing: number; conflict: number };
}

export interface AssignProjectAffiliatePayload {
  businessPartyVersionId: string;
  effectiveFrom: string;
  changeReason: string;
}

export interface ProjectOperatingOverviewReadModel {
  project: ProjectOptionReadModel;
  cash: {
    actualReceiptsCents: string | null;
    legacyReceiptsCents: string;
    affiliateRemittanceCents: string;
    supplierRefundsCents: string | null;
    availableFundsCents: string | null;
    actualPaidCents: string;
    approvalPendingOccupancyCents: string;
    approvedPendingPaymentCents: string;
    financeRecordedOutflowCents: string;
  };
  business: {
    effectiveContractAmountCents: string;
    effectiveSettlementAmountCents: string;
    payableSettlementAmountCents: string;
    operatingIncomeCents: string | null;
    affiliateDownstreamPaymentCents: string;
    operatingCostCents: string | null;
    grossProfitCents: string | null;
  };
  upstreamFunds: {
    ownerPaymentCents: string;
    affiliateRemittanceCents: string;
    affiliateDeductionCents: string;
    unreconciledReceiptDifferenceCents: string;
    writtenCount: number;
    oralCount: number;
    rows: ProjectUpstreamFundFactReadModel[];
  };
  counts: {
    contracts: number;
    settlements: number;
    payments: number;
  };
  dataGaps: string[];
}

export type ProjectUpstreamFundFactType =
  | "owner_payment_to_affiliate"
  | "affiliate_remittance_to_company"
  | "affiliate_deduction"
  | "unreconciled_receipt_difference";
export type ProjectUpstreamFundBasisType = "written" | "oral";

export interface ProjectUpstreamFundFactReadModel {
  id: string;
  projectId: string;
  factType: ProjectUpstreamFundFactType;
  factTypeLabel: string;
  entryKind: "original" | "correction" | "reversal" | "reclassification";
  adjustsFactId: string | null;
  effectDirection: "increase" | "decrease";
  occurredAt: string;
  amountCents: string;
  signedAmountCents: string;
  cashEffectCents: string;
  counterpartyName: string;
  basisType: ProjectUpstreamFundBasisType;
  deductionCategory: "management_fee" | "tax" | "deposit" | "insurance" | "other" | null;
  upstreamSettlementId: string | null;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  status: "pending_confirm" | "confirmed" | "pending_reconciliation";
  recordedByUserId: string;
  recordedByRoleKey: "finance_staff" | "finance_director";
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  confirmationSignatureVersionId: string | null;
  createdAt: string;
}

export interface RecordProjectUpstreamFundFactPayload {
  factType: ProjectUpstreamFundFactType;
  basisType: ProjectUpstreamFundBasisType;
  occurredAt: string;
  amountCents: string;
  counterpartyName: string;
  deductionCategory?: "management_fee" | "tax" | "deposit" | "insurance" | "other";
  upstreamSettlementId?: string;
  evidenceFileId?: string;
  idempotencyKey: string;
  entryKind?: "original" | "correction" | "reversal" | "reclassification";
  adjustsFactId?: string;
  effectDirection?: "increase" | "decrease";
  description?: string;
}

export interface ConfirmProjectUpstreamFundFactPayload {
  confirmationPassword: string;
  confirmationActionId: string;
}

export type ProjectAffiliateBusinessFactType = "contract" | "settlement" | "payment";
export type ProjectAffiliateBasisType = "written" | "oral";
export type ProjectAffiliateEntryKind = "original" | "correction" | "reversal";
export type ProjectAffiliateFactAction =
  | "confirm"
  | "supplement_evidence"
  | "record_correction"
  | "record_reversal";

export interface ProjectAffiliateBusinessEvidenceReadModel {
  id: string;
  projectId: string;
  businessType: ProjectAffiliateBusinessFactType;
  businessFactId: string;
  fileId: string;
  documentVersion: number;
  fileContentSha256Snapshot: string;
  description: string;
  recordedByUserId: string;
  recordedByRoleKey: string;
  createdAt: string;
}

interface ProjectAffiliateFactReadModelBase {
  id: string;
  ledgerId: string;
  projectId: string;
  entryKind: ProjectAffiliateEntryKind;
  adjustsFactId: string | null;
  effectDirection: "increase" | "decrease";
  counterpartyName: string;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  basisType: ProjectAffiliateBasisType;
  description: string | null;
  evidenceFileId: string | null;
  status: "pending_confirm" | "confirmed";
  recordedByUserId: string;
  recordedByRoleKey: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  confirmationSignatureVersionId: string | null;
  createdAt: string;
  availableActions: ProjectAffiliateFactAction[];
  supplementalEvidence: ProjectAffiliateBusinessEvidenceReadModel[];
}

export type ProjectAffiliateContractType =
  | "material_purchase"
  | "equipment_rental"
  | "labor_subcontract"
  | "professional_subcontract"
  | "general_settlement"
  | "general_direct_payment";

export interface ProjectAffiliateContractFactReadModel
  extends ProjectAffiliateFactReadModelBase {
  contractType: ProjectAffiliateContractType;
  externalContractReference: string;
  signedAt: string;
  amountNature: "fixed" | "uncapped";
  amountCents: string | null;
  advanceAllowed: boolean;
  advanceLimitCents: string | null;
  advanceTermsSummary: string | null;
}

export interface ProjectAffiliateSettlementFactReadModel
  extends ProjectAffiliateFactReadModelBase {
  contractLedgerId: string;
  settledAt: string;
  periodLabel: string;
  amountCents: string;
}

export type ProjectAffiliatePaymentKind =
  | "normal"
  | "advance"
  | "direct_contract";

export interface ProjectAffiliatePaymentFactReadModel
  extends ProjectAffiliateFactReadModelBase {
  contractLedgerId: string;
  settlementLedgerId: string | null;
  paidAt: string;
  amountCents: string;
  paymentKind: ProjectAffiliatePaymentKind;
  externalPaymentReference: string | null;
  paymentSubjectType: "affiliate";
  companyCashExecutionAllowed: false;
}

export interface ProjectAffiliateBusinessFactsReadModel {
  availableActions: Array<"record_contract" | "record_settlement" | "record_payment">;
  contracts: ProjectAffiliateContractFactReadModel[];
  settlements: ProjectAffiliateSettlementFactReadModel[];
  payments: ProjectAffiliatePaymentFactReadModel[];
}

export interface RecordProjectAffiliateContractFactPayload {
  contractType: ProjectAffiliateContractType;
  externalContractReference: string;
  counterpartyName: string;
  signedAt: string;
  amountNature: "fixed" | "uncapped";
  amountCents?: string;
  basisType: ProjectAffiliateBasisType;
  evidenceFileId?: string;
  advanceAllowed: boolean;
  advanceLimitCents?: string;
  advanceTermsSummary?: string;
  idempotencyKey: string;
  entryKind?: ProjectAffiliateEntryKind;
  adjustsFactId?: string;
  effectDirection?: "increase" | "decrease";
  description?: string;
}

export interface RecordProjectAffiliateSettlementFactPayload {
  contractLedgerId: string;
  counterpartyName: string;
  settledAt: string;
  periodLabel: string;
  amountCents: string;
  basisType: ProjectAffiliateBasisType;
  evidenceFileId?: string;
  idempotencyKey: string;
  entryKind?: ProjectAffiliateEntryKind;
  adjustsFactId?: string;
  effectDirection?: "increase" | "decrease";
  description?: string;
}

export interface RecordProjectAffiliatePaymentFactPayload {
  contractLedgerId: string;
  settlementLedgerId?: string;
  counterpartyName: string;
  paidAt: string;
  amountCents: string;
  paymentKind: ProjectAffiliatePaymentKind;
  externalPaymentReference?: string;
  basisType: ProjectAffiliateBasisType;
  evidenceFileId?: string;
  idempotencyKey: string;
  entryKind?: ProjectAffiliateEntryKind;
  adjustsFactId?: string;
  effectDirection?: "increase" | "decrease";
  description?: string;
}

export interface ConfirmProjectAffiliateBusinessFactPayload {
  confirmationPassword: string;
  confirmationActionId: string;
}

export interface ProjectAffiliateCompanyContractReadModel {
  id: string;
  projectId: string;
  contractReference: string;
  contractName: string;
  signedAt: string;
  rightsObligationsSummary: string;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  affiliateCreditCodeSnapshot: string | null;
  companyEntityId: string;
  companyEntityVersionId: string;
  companyEntityNameSnapshot: string;
  companyEntityCreditCodeSnapshot: string;
  companyEntityRegisteredAddressSnapshot: string | null;
  fileId: string;
  documentVersion: number;
  fileContentSha256Snapshot: string;
  status: "pending_confirm" | "confirmed";
  recordedByUserId: string;
  recordedByRoleKey: "contract_staff";
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  confirmationSignatureVersionId: string | null;
  agreementScope: "affiliate_to_our_company";
  ownerContractReplacementAllowed: false;
  ownerReceiptCreated: false;
  companyApprovalCreated: false;
  companySealCreated: false;
  companyPaymentWorkflowCreated: false;
  affiliateRemittanceRequiresContractSettlement: false;
  availableActions: Array<"confirm">;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAffiliateCompanyContractsReadModel {
  availableActions: Array<"record_affiliate_company_contract">;
  contracts: ProjectAffiliateCompanyContractReadModel[];
}

export interface RecordProjectAffiliateCompanyContractPayload {
  contractReference: string;
  contractName: string;
  signedAt: string;
  rightsObligationsSummary: string;
  companyEntityId: string;
  fileId: string;
  idempotencyKey: string;
}

export interface RecordProjectAffiliateCompanyContractWithUploadInput<TContext> {
  form: {
    contractReference: string;
    contractName: string;
    signedAt: string;
    rightsObligationsSummary: string;
    companyEntityId: string;
  };
  files: Array<{
    raw?: Blob & { name?: string };
  }>;
  idempotencyKey: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface ProjectAffiliateCompanyContractRecordSubmission {
  projectId: string;
  contractReference: string;
  contractName: string;
  signedAt: string;
  rightsObligationsSummary: string;
  companyEntityId: string;
  idempotencyKey: string;
  file: Blob;
  fileName: string;
  isCurrent: () => boolean;
}

export interface ProjectAffiliateCompanyContractRecordAttemptState {
  submission: ProjectAffiliateCompanyContractRecordSubmission | null;
  uploadedFileId: string | null;
  uploadPromise: Promise<PrivateFileReadModel> | null;
  requestPromise: Promise<ProjectAffiliateCompanyContractReadModel> | null;
}

export interface SupplementProjectAffiliateBusinessEvidencePayload {
  businessType: ProjectAffiliateBusinessFactType;
  fileId: string;
  idempotencyKey: string;
  description: string;
}

export interface RecordProjectProxyPaymentPayload {
  paidAt: string;
  amountCents: string;
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
  reportedAmountCents: string;
  approvedAmountCents: string;
  approvingPartyName: string;
  periodLabel: string;
  isFinal?: boolean;
  description?: string;
  voucherFileId: string;
}

export interface ConfirmProjectUpstreamSettlementPayload {
  confirmationPassword: string;
}

export interface RecordProjectOwnerContractPayload {
  ownerName: string;
  contractName: string;
  contractCode: string;
  signedAt: string;
  amountCents: string;
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
  amountCents: string;
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
  amountCents: string;
  reason: string;
  validUntil?: string;
  attachmentFileId: string;
}

export interface ReviewProjectFinancingQuotaPayload {
  decision: "approve" | "reject";
  confirmationPassword: string;
  comment?: string;
  selfReviewReason?: string;
}

export interface TerminateProjectFinancingQuotaPayload {
  reason: string;
  confirmationPassword: string;
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
  requestedAmountCents: string;
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
  approvedAmountCents?: string;
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface VoidProjectExpenseRequestPayload {
  reason: string;
}

export interface RecordProjectExpenseExecutionPayload {
  amountCents: string;
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
  amountCents: string;
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
    requestedAmountCents: string;
    approvedAmountCents: string | null;
    paidAmountCents: string;
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
    lifecycleUpdatedAt?: string | null;
    hasPersistentDraft?: false;
    availableActions?: string[];
    blockedReasons?: string[];
  }>;
  summary: {
    total: number;
    approvalPending: number;
    approvedPendingPayment: number;
    paid: number;
    paymentBlocked: number;
    totalRequestedCents: string;
    totalPaidCents: string;
  };
  view?: DraftLedgerView;
  hasPersistentDraft?: false;
  pagination?: LifecycleLedgerPageMeta;
  viewCounts?: LifecycleLedgerViewCount;
  statistics?: {
    formalTotal: number;
    pendingApproval: number;
    pendingPayment: number;
    paid: number;
    formalRequestedAmountCents: string;
    formalPaidAmountCents: string;
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

export type WorkItemQueueKey = "pending" | "blocked" | "started" | "drafts";
export type ApprovalCenterViewKey =
  | "pendingApproval"
  | "startedByMe"
  | "handledByMe"
  | "delegatedToMe"
  | "overdueReminder";

export interface WorkItemReadModel {
  id: string;
  type: "draft" | "contract_takeover" | "archive" | "approval" | "payment_execution" | "blocker";
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
  ageDays?: number;
  agingStatus?: "current" | "long_running" | "stale";
}

export interface WorkItemsReadModel {
  generatedAt: string;
  visibleProjectCount: number;
  queues: Record<WorkItemQueueKey, WorkItemReadModel[]>;
  queueMeta?: Record<WorkItemQueueKey, {
    total: number;
    returned: number;
    truncated: boolean;
  }>;
  approvalCenter: Record<ApprovalCenterViewKey, WorkItemReadModel[]>;
}

export function fetchWorkbenchSummary() {
  return readJson<WorkbenchSummaryReadModel>("/me/workbench-summary");
}

export function fetchWorkItems() {
  return readJson<WorkItemsReadModel>("/me/work-items");
}

export interface DraftRetentionPreviewReadModel {
  generatedAt: string;
  mode: "preview_only";
  executionAllowed: false;
  policyVersion: string;
  totalCandidateCount: number;
  categories: Array<{
    key: string;
    label: string;
    retentionDays: number;
    candidateCount: number;
    oldestCandidateAt: string | null;
    rule: string;
  }>;
  fileScanTruncated: boolean;
  notice: string;
}

export function fetchDraftRetentionPreview() {
  return readJson<DraftRetentionPreviewReadModel>("/draft-retention/preview");
}

export function fetchProjects() {
  return readJson<ProjectOptionReadModel[]>("/projects");
}

export function fetchContractCreateProjects() {
  return readJson<ProjectOptionReadModel[]>("/projects/contract-create-options");
}

export function fetchProjectAffiliateMappingReport() {
  return readJson<ProjectAffiliateMappingReportReadModel>(
    "/projects/affiliate-mapping-report"
  );
}

export function assignProjectAffiliate(
  projectId: string,
  body: AssignProjectAffiliatePayload
) {
  return postJson<Record<string, unknown>>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-assignment`,
    body
  );
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

export function fetchProjectExpenseRequests(
  projectId: string,
  query?: { view: DraftLedgerView; page: number; pageSize: number }
) {
  const encodedProjectId = encodeURIComponent(projectId);
  const suffix = query
    ? `?${new URLSearchParams({
        view: query.view,
        page: String(query.page),
        pageSize: String(query.pageSize)
      }).toString()}`
    : "";
  return readJson<ProjectExpenseRequestListReadModel>(
    `/projects/${encodedProjectId}/expense-requests${suffix}`
  );
}

export function recordProjectUpstreamFundFact(
  projectId: string,
  body: RecordProjectUpstreamFundFactPayload
) {
  return postJson<ProjectUpstreamFundFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/upstream-fund-facts`,
    body
  );
}

export function confirmProjectUpstreamFundFact(
  projectId: string,
  fundFactId: string,
  body: ConfirmProjectUpstreamFundFactPayload
) {
  return postJson<ProjectUpstreamFundFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/upstream-fund-facts/${encodeURIComponent(fundFactId)}/confirmation`,
    body
  );
}

export function fetchProjectAffiliateBusinessFacts(projectId: string) {
  return readJson<ProjectAffiliateBusinessFactsReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-business-facts`
  );
}

export function fetchProjectAffiliateCompanyContracts(projectId: string) {
  return readJson<ProjectAffiliateCompanyContractsReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-company-contracts`
  );
}

export function recordProjectAffiliateCompanyContract(
  projectId: string,
  body: RecordProjectAffiliateCompanyContractPayload
) {
  return postJson<ProjectAffiliateCompanyContractReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-company-contracts`,
    body
  );
}

export function confirmProjectAffiliateCompanyContract(
  projectId: string,
  contractId: string,
  body: ConfirmProjectAffiliateBusinessFactPayload
) {
  return postJson<ProjectAffiliateCompanyContractReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-company-contracts/${encodeURIComponent(contractId)}/confirmation`,
    body
  );
}

export function recordProjectAffiliateContractFact(
  projectId: string,
  body: RecordProjectAffiliateContractFactPayload
) {
  return postJson<ProjectAffiliateContractFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-contract-facts`,
    body
  );
}

export function confirmProjectAffiliateContractFact(
  projectId: string,
  factId: string,
  body: ConfirmProjectAffiliateBusinessFactPayload
) {
  return postJson<ProjectAffiliateContractFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-contract-facts/${encodeURIComponent(factId)}/confirmation`,
    body
  );
}

export function recordProjectAffiliateSettlementFact(
  projectId: string,
  body: RecordProjectAffiliateSettlementFactPayload
) {
  return postJson<ProjectAffiliateSettlementFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-settlement-facts`,
    body
  );
}

export function confirmProjectAffiliateSettlementFact(
  projectId: string,
  factId: string,
  body: ConfirmProjectAffiliateBusinessFactPayload
) {
  return postJson<ProjectAffiliateSettlementFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-settlement-facts/${encodeURIComponent(factId)}/confirmation`,
    body
  );
}

export function recordProjectAffiliatePaymentFact(
  projectId: string,
  body: RecordProjectAffiliatePaymentFactPayload
) {
  return postJson<ProjectAffiliatePaymentFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-payment-facts`,
    body
  );
}

export function confirmProjectAffiliatePaymentFact(
  projectId: string,
  factId: string,
  body: ConfirmProjectAffiliateBusinessFactPayload
) {
  return postJson<ProjectAffiliatePaymentFactReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-payment-facts/${encodeURIComponent(factId)}/confirmation`,
    body
  );
}

export function supplementProjectAffiliateBusinessEvidence(
  projectId: string,
  factId: string,
  body: SupplementProjectAffiliateBusinessEvidencePayload
) {
  return postJson<ProjectAffiliateBusinessEvidenceReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-business-facts/${encodeURIComponent(factId)}/evidence`,
    body
  );
}

export function recordProjectProxyPayment(projectId: string, body: RecordProjectProxyPaymentPayload) {
  return postJson<unknown>(`/projects/${projectId}/proxy-payments`, body);
}

export function recordProjectUpstreamSettlement(
  projectId: string,
  body: RecordProjectUpstreamSettlementPayload
) {
  return postJson<unknown>(
    `/projects/${encodeURIComponent(projectId)}/upstream-settlements`,
    body
  );
}

export function confirmProjectUpstreamSettlement(
  projectId: string,
  upstreamSettlementId: string,
  body: ConfirmProjectUpstreamSettlementPayload
) {
  return postJson<unknown>(
    `/projects/${encodeURIComponent(projectId)}/upstream-settlements/${encodeURIComponent(upstreamSettlementId)}/confirmation`,
    body
  );
}

export function recordProjectOwnerContract(projectId: string, body: RecordProjectOwnerContractPayload) {
  return postJson<unknown>(`/projects/${encodeURIComponent(projectId)}/owner-contracts`, body);
}

export function confirmProjectOwnerContract(
  projectId: string,
  ownerContractId: string,
  body: ConfirmProjectOwnerContractPayload
) {
  return postJson<unknown>(
    `/projects/${encodeURIComponent(projectId)}/owner-contracts/${encodeURIComponent(ownerContractId)}/confirmation`,
    body
  );
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

export function terminateProjectFinancingQuota(
  projectId: string,
  quotaId: string,
  body: TerminateProjectFinancingQuotaPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/financing-quotas/${quotaId}/termination`,
    body
  );
}

export function createProjectExpenseRequest(
  projectId: string,
  body: CreateProjectExpenseRequestPayload
) {
  return postJson<unknown>(`/projects/${projectId}/expense-requests`, body);
}

export function fetchProjectExpenseApprovalDetail(
  projectId: string,
  expenseRequestId: string
) {
  return readJson<ProjectExpenseApprovalLifecycleDetailReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/${encodeURIComponent(expenseRequestId)}/approval-detail`
  );
}

export type ProjectExpenseApprovalLifecycleDetailReadModel =
  ProjectExpenseApprovalDetailReadModel & {
    lifecycleUpdatedAt: string | null;
    hasPersistentDraft: false;
    availableActions: DetailActionReadModel[];
    blockedReasons: string[];
  };

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

export type ContractLifecycleLedgerRow = ContractLedgerListReadModel["rows"][number] & {
  contractVersionId?: string;
  typePricing?: string;
  status?: string;
  workbenchEditable?: boolean;
  lifecycleKind?: "pristine_draft" | "approval_draft" | "formal_record";
  draftRevision?: number;
  lifecycleUpdatedAt?: string;
  abandonedAt?: string | null;
  abandonReason?: string | null;
  copyAvailable?: boolean;
};

export function copyAbandonedContractDraft(contractVersionId: string, expectedUpdatedAt: string) {
  return postJson<{ contract: { id: string }; version: { id: string } }>(
    `/contracts/${encodeURIComponent(contractVersionId)}/copies`,
    { expectedUpdatedAt }
  );
}

export function fetchContractLifecycleLedger(
  view: DraftLedgerView,
  page: number,
  pageSize: number
) {
  const query = new URLSearchParams({
    view,
    page: String(page),
    pageSize: String(pageSize)
  });
  return readJson<LifecycleLedgerPage<ContractLifecycleLedgerRow>>(
    `/contracts/lifecycle-ledger?${query.toString()}`
  );
}

export function fetchContractWorkbenchLedger(
  view: ContractWorkbenchView,
  page: number,
  pageSize: number
) {
  const query = new URLSearchParams({
    view,
    page: String(page),
    pageSize: String(pageSize)
  });
  return readJson<ContractWorkbenchLedgerPage<ContractLifecycleLedgerRow>>(
    `/contracts/workbench?${query.toString()}`
  );
}

export function downloadContractLedgerExport() {
  return downloadWorkbook("/contracts/ledger-export", "合同台账.xlsx", "导出合同台账失败");
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

export type SettlementLifecycleLedgerRow = SettlementLedgerListReadModel["rows"][number] & {
  projectId: string;
  settlementId?: string;
  lifecycleKind?: "pristine_draft" | "approval_draft" | "formal_record";
  revision?: number;
  lifecycleUpdatedAt?: string;
  abandonedAt?: string | null;
  abandonReason?: string | null;
  copyAvailable?: boolean;
};

export type SettlementWorkbenchLedgerRow = SettlementLifecycleLedgerRow & {
  status?: string;
};

export function copyAbandonedSettlementDraft(
  projectId: string,
  draftId: string,
  expectedUpdatedAt: string
) {
  return postJson<{ id: string }>(
    `/projects/${encodeURIComponent(projectId)}/settlement-drafts/${encodeURIComponent(draftId)}/copies`,
    { expectedUpdatedAt }
  );
}

export function fetchSettlementLifecycleLedger(
  view: DraftLedgerView,
  page: number,
  pageSize: number
) {
  const query = new URLSearchParams({
    view,
    page: String(page),
    pageSize: String(pageSize)
  });
  return readJson<LifecycleLedgerPage<SettlementLifecycleLedgerRow>>(
    `/settlements/lifecycle-ledger?${query.toString()}`
  );
}

export function fetchSettlementWorkbenchLedger(
  view: SettlementWorkbenchView,
  page: number,
  pageSize: number
) {
  const query = new URLSearchParams({
    view,
    page: String(page),
    pageSize: String(pageSize)
  });
  return readJson<SettlementWorkbenchLedgerPage<SettlementWorkbenchLedgerRow>>(
    `/settlements/workbench?${query.toString()}`
  );
}

export function downloadSettlementLedgerExport() {
  return downloadWorkbook(
    "/settlements/ledger-export",
    "结算台账.xlsx",
    "导出结算台账失败"
  );
}

export function fetchPaymentLedger() {
  return readJson<PaymentLedgerListReadModel>("/payments");
}

export type PaymentLifecycleLedgerRow = PaymentLedgerListReadModel["rows"][number] & {
  lifecycleKind: "approval_draft" | "formal_record";
  ledgerView: DraftLedgerView;
  lifecycleUpdatedAt: string | null;
  requestedAmountCents: string;
  paidAmountCents: string;
  availableActions: string[];
  blockedReasons: string[];
};

export interface PaymentLifecycleLedgerPage {
  rows: PaymentLifecycleLedgerRow[];
  view: DraftLedgerView;
  hasPersistentDraft: false;
  pagination: LifecycleLedgerPageMeta;
  viewCounts: LifecycleLedgerViewCount;
  statistics: {
    formalRequestedAmountCents: string;
    formalPaidAmountCents: string;
    pendingApproval: number;
    pendingPayment: number;
    paid: number;
  };
}

export function fetchPaymentLifecycleLedger(
  view: DraftLedgerView,
  page: number,
  pageSize: number
) {
  const query = new URLSearchParams({
    view,
    page: String(page),
    pageSize: String(pageSize)
  });
  return readJson<PaymentLifecycleLedgerPage>(`/payments?${query.toString()}`);
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

export function uploadPrivateFile(
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }

  return postForm<PrivateFileReadModel>("/files", form);
}

export function createProjectAffiliateCompanyContractRecordAttemptState(): ProjectAffiliateCompanyContractRecordAttemptState {
  return {
    submission: null,
    uploadedFileId: null,
    uploadPromise: null,
    requestPromise: null
  };
}

export function recordProjectAffiliateCompanyContractWithUpload<TContext>(
  projectId: string,
  input: RecordProjectAffiliateCompanyContractWithUploadInput<TContext>,
  state: ProjectAffiliateCompanyContractRecordAttemptState
) {
  if (state.requestPromise) return state.requestPromise;
  let submission: ProjectAffiliateCompanyContractRecordSubmission;
  try {
    submission =
      state.submission ??
      normalizeAffiliateCompanyContractRecord(projectId, input);
    if (submission.projectId !== projectId) {
      throw new Error(
        "线下合同登记重试项目已变化，请重新打开登记窗口"
      );
    }
    state.submission = submission;
  } catch (error) {
    return Promise.reject(error);
  }
  const request = executeAffiliateCompanyContractRecord(
    projectId,
    submission,
    state
  );
  state.requestPromise = request;
  void request.catch(() => {
    if (state.requestPromise === request) {
      state.requestPromise = null;
    }
  });
  return request;
}

function normalizeAffiliateCompanyContractRecord<TContext>(
  projectId: string,
  input: RecordProjectAffiliateCompanyContractWithUploadInput<TContext>
): ProjectAffiliateCompanyContractRecordSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error("线下合同登记上下文已失效，请重新读取当前项目");
  }
  const file = input.files[0]?.raw;
  if (!(file instanceof Blob)) {
    throw new Error("请上传已由双方线下签署的正式合同文件");
  }
  return {
    projectId: requiredAffiliateCompanyContractRecordText(
      projectId,
      "当前项目"
    ),
    contractReference: requiredAffiliateCompanyContractRecordText(
      input.form.contractReference,
      "线下合同编号"
    ),
    contractName: requiredAffiliateCompanyContractRecordText(
      input.form.contractName,
      "线下合同名称"
    ),
    signedAt: requiredAffiliateCompanyContractRecordText(
      input.form.signedAt,
      "签订日期"
    ),
    rightsObligationsSummary:
      requiredAffiliateCompanyContractRecordText(
        input.form.rightsObligationsSummary,
        "双方权利义务摘要"
      ),
    companyEntityId: requiredAffiliateCompanyContractRecordText(
      input.form.companyEntityId,
      "我方签约主体"
    ),
    idempotencyKey: requiredAffiliateCompanyContractRecordText(
      input.idempotencyKey,
      "线下合同登记幂等键"
    ),
    file,
    fileName: requiredAffiliateCompanyContractRecordText(
      file.name ?? "",
      "已签合同文件名"
    ),
    isCurrent: () => input.isCurrent(input.context)
  };
}

async function executeAffiliateCompanyContractRecord(
  projectId: string,
  submission: ProjectAffiliateCompanyContractRecordSubmission,
  state: ProjectAffiliateCompanyContractRecordAttemptState
) {
  if (!submission.isCurrent()) {
    throw new Error("线下合同登记上下文已失效，请重新读取当前项目");
  }
  let fileId = state.uploadedFileId;
  if (fileId === null) {
    const upload =
      state.uploadPromise ??
      uploadPrivateFile(
        submission.file,
        submission.fileName,
        submission.idempotencyKey
      );
    state.uploadPromise = upload;
    try {
      const uploaded = await upload;
      if (uploaded.id !== submission.idempotencyKey) {
        throw new Error(
          "文件上传幂等响应不一致，请刷新页面后重新登记"
        );
      }
      fileId = uploaded.id;
      state.uploadedFileId = uploaded.id;
    } catch (error) {
      if (state.uploadPromise === upload) {
        state.uploadPromise = null;
      }
      throw error;
    }
  }
  if (!submission.isCurrent()) {
    throw new Error("线下合同登记上下文已失效，请重新读取当前项目");
  }
  return recordProjectAffiliateCompanyContract(projectId, {
    contractReference: submission.contractReference,
    contractName: submission.contractName,
    signedAt: submission.signedAt,
    rightsObligationsSummary: submission.rightsObligationsSummary,
    companyEntityId: submission.companyEntityId,
    idempotencyKey: submission.idempotencyKey,
    fileId
  });
}

function requiredAffiliateCompanyContractRecordText(
  value: string,
  label: string
) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`请填写${label}`);
  return normalized;
}

export interface CreatePrivateFileDownloadTicketPayload {
  confirmationPassword: string;
  downloadReason: string;
  accessMode?: "download" | "preview";
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
  return readJson<ContractTakeoverReadModel[]>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers`
  );
}

export function listHistoricalCompanyEntityCandidates(projectId: string) {
  return readJson<HistoricalCompanyEntityCandidateReadModel[]>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/company-entity-candidates`
  );
}

export function downloadContractTakeoverLedgerExport(projectId: string) {
  return downloadWorkbook(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/ledger-export`,
    "历史合同接管台账.xlsx",
    "导出历史合同接管台账失败"
  );
}

export function downloadContractTakeoverDetailExport(
  projectId: string,
  takeoverId: string
) {
  return downloadWorkbook(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/${encodeURIComponent(
      takeoverId
    )}/detail-export`,
    "历史合同接管详情.xlsx",
    "导出历史合同接管详情失败"
  );
}

export async function downloadContractTakeoverImportTemplate(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/contract-takeovers/import-template`);
  await ensureOk(response, "下载历史合同接管模板失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : "历史合同接管导入模板.xlsx";
  saveBlob(blob, fileName);
}

export function listContractTakeoverImportBatches(projectId: string) {
  return readJson<ContractTakeoverImportBatchReadModel[]>(
    `/projects/${projectId}/contract-takeovers/import-batches`
  );
}

export function previewContractTakeoverBatchAbandonment(
  projectId: string,
  batchId: string
) {
  return postJson<ContractTakeoverBatchAbandonmentPreviewReadModel>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/import-batches/${encodeURIComponent(batchId)}/draft-abandonment-preview`
  );
}

export function applyContractTakeoverBatchAbandonment(
  projectId: string,
  batchId: string,
  body: ApplyContractTakeoverBatchAbandonmentPayload
) {
  return postJson<ApplyContractTakeoverBatchAbandonmentReadModel>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/import-batches/${encodeURIComponent(batchId)}/draft-abandonment-apply`,
    body
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

export function abandonContractTakeover(
  projectId: string,
  takeoverId: string,
  body: AbandonContractTakeoverPayload
) {
  return postJson<AbandonContractTakeoverReadModel>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/${encodeURIComponent(takeoverId)}/abandonment`,
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

export function previewContractTakeoverExcelImport(projectId: string, fileId: string) {
  return postJson<ContractTakeoverExcelPreviewReadModel>(
    `/projects/${projectId}/contract-takeovers/imports/preview`,
    { fileId }
  );
}

export function applyContractTakeoverExcelImport(
  projectId: string,
  body: ApplyContractTakeoverExcelPayload
) {
  return postJson<ContractTakeoverImportDraftReadModel>(
    `/projects/${projectId}/contract-takeovers/imports/apply`,
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

export function attachHistoricalPaymentVoucher(
  projectId: string,
  takeoverId: string,
  body: AttachHistoricalPaymentVoucherPayload
) {
  return postJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/payment-evidence-files`,
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

export interface SaveContractTakeoverContractSidePayload {
  idempotencyKey: string;
  expectedRevision: number;
  signedAt: string;
  performanceStatus: ContractTakeoverPerformanceStatus;
  historicalSettledCents: string;
  settlementEvidenceSummary: string;
  settlementEvidenceFileIds: string[];
  paymentTerms: ContractTakeoverContractSideReadModel["paymentTerms"];
  contractFacts: ContractTakeoverContractSideReadModel["contractFacts"];
}

export interface SaveContractTakeoverFinanceSidePayload {
  idempotencyKey: string;
  expectedRevision: number;
  basedOnContractRevision: number;
  basedOnFinanceBasisRevision: number;
  zeroPaymentDeclared: boolean;
  excessTreatment?: "historical_advance" | "abnormal_overpay";
  excessReason?: string;
  excessEvidenceFileIds?: string[];
  payments: Array<{
    rowKey: string;
    amountCents: string;
    paidAt: string;
    payerName?: string;
    payeeName?: string;
    bankReference?: string;
    paymentMethod?: string;
    note?: string;
    voucherFileIds: string[];
  }>;
}

export interface ContractTakeoverSideSaveReadModel {
  takeoverId: string;
  side: "contract" | "finance";
  revision: number;
  confirmedRevision: null;
  savedAt: string;
}

export interface ConfirmContractTakeoverSidePayload {
  idempotencyKey: string;
  expectedRevision: number;
  currentPassword: string;
  basedOnContractRevision?: number;
  basedOnFinanceBasisRevision?: number;
}

export interface WithdrawContractTakeoverSidePayload {
  idempotencyKey: string;
  expectedRevision: number;
  currentPassword: string;
  reason: string;
}

export interface SubmitContractTakeoverCorrectionPayload {
  correctionScope: ContractTakeoverCorrectionScope;
  correctionOperation: ContractTakeoverCorrectionOperation;
  targetRevision: number;
  targetBalanceRevision?: number;
  deltaCents?: string;
  targetHistoricalPaymentId?: string;
  targetAllocationId?: string;
  targetBalanceEntryId?: string;
  reclassificationTarget?: "historical_advance" | "abnormal_overpay";
  reason: string;
  responsibleUserId: string;
  attachmentFileId: string;
  applicationIdempotencyKey: string;
  currentPassword: string;
}

export function saveContractTakeoverContractSide(
  projectId: string,
  takeoverId: string,
  body: SaveContractTakeoverContractSidePayload
) {
  return putJson<ContractTakeoverSideSaveReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/contract-side`,
    body
  );
}

export function saveContractTakeoverFinanceSide(
  projectId: string,
  takeoverId: string,
  body: SaveContractTakeoverFinanceSidePayload
) {
  return putJson<ContractTakeoverSideSaveReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/finance-side`,
    body
  );
}

export function confirmContractTakeoverContractSide(
  projectId: string,
  takeoverId: string,
  body: ConfirmContractTakeoverSidePayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/contract-side/confirmation`,
    body
  );
}

export function confirmContractTakeoverFinanceSide(
  projectId: string,
  takeoverId: string,
  body: ConfirmContractTakeoverSidePayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/finance-side/confirmation`,
    body
  );
}

export function withdrawContractTakeoverContractSideConfirmation(
  projectId: string,
  takeoverId: string,
  body: WithdrawContractTakeoverSidePayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/contract-side/confirmation-withdrawal`,
    body
  );
}

export function withdrawContractTakeoverFinanceSideConfirmation(
  projectId: string,
  takeoverId: string,
  body: WithdrawContractTakeoverSidePayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/finance-side/confirmation-withdrawal`,
    body
  );
}

export function submitContractTakeoverCorrection(
  projectId: string,
  takeoverId: string,
  body: SubmitContractTakeoverCorrectionPayload
) {
  return postJson<unknown>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/corrections`,
    body
  );
}

export function reviewContractTakeoverCorrection(
  projectId: string,
  takeoverId: string,
  correctionId: string,
  body: {
    decision: "apply" | "reject";
    reviewComment: string;
    currentPassword: string;
  }
) {
  return postJson<unknown>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/corrections/${correctionId}/review`,
    body
  );
}

export function submitContractTakeoverCompanyEntityCorrection(
  projectId: string,
  takeoverId: string,
  body: SubmitContractTakeoverCompanyEntityCorrectionPayload
) {
  return postJson<{ id: string; status: string; message: string }>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/company-entity-corrections`,
    body
  );
}

export function reviewContractTakeoverCompanyEntityCorrection(
  projectId: string,
  takeoverId: string,
  correctionId: string,
  body: ReviewContractTakeoverCompanyEntityCorrectionPayload
) {
  return postJson<{ id: string; status: string; message: string }>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/company-entity-corrections/${correctionId}/review`,
    body
  );
}

export function submitContractTakeoverReview(projectId: string, takeoverId: string) {
  return postJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/review-submission`
  );
}

export function returnContractTakeoverForSupplement(
  projectId: string,
  takeoverId: string,
  body: ReturnContractTakeoverForSupplementPayload
) {
  return postJson<ContractTakeoverReadModel>(
    `/projects/${projectId}/contract-takeovers/${takeoverId}/supplement-return`,
    body
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

export interface ConfirmContractTakeoverChangeBaselinePayload {
  originalSignedAmountCents: string;
  preTakeoverPositiveIncreaseCents: string;
  currentPassword: string;
}

export interface ConfirmContractTakeoverChangeBaselineReadModel {
  takeoverId: string;
  contractVersionId: string;
  changeBaselineConfirmed: true;
  originalBaseAmountCents: string;
  preTakeoverPositiveIncreaseCents: string;
}

export function confirmContractTakeoverChangeBaseline(
  projectId: string,
  takeoverId: string,
  body: ConfirmContractTakeoverChangeBaselinePayload
) {
  return postJson<ConfirmContractTakeoverChangeBaselineReadModel>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/${encodeURIComponent(takeoverId)}/change-baseline-confirmation`,
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

export interface CompleteContractSealPayload {
  firstPartySignedOrStamped: boolean;
  companySealCompleted: boolean;
  crossPageSealCompleted: boolean;
  signingDateCompleted: boolean;
}

export interface UploadMutuallySignedContractPayload extends CompleteContractSealPayload {
  fileId: string;
  sourceRevision: number;
  onlyPermittedSignatureChanges: boolean;
  documentOrderConfirmed: boolean;
}

export interface ReturnMutuallySignedContractPayload {
  formalFileId: string;
  reason: string;
}

export interface ConfirmMutuallySignedContractPayload extends CompleteContractSealPayload {
  formalFileId: string;
  onlyPermittedSignatureChanges: boolean;
  documentOrderConfirmed: boolean;
  confirmationPassword: string;
}

function governedContractPath(contractVersionId: string, suffix: string) {
  return `/contracts/${encodeURIComponent(contractVersionId)}/${suffix}`;
}

export interface ApproveContractSealPayload {
  confirmationPassword: string;
}

export function approveGovernedContractSeal(
  contractVersionId: string,
  body: ApproveContractSealPayload
) {
  return postJson<unknown>(governedContractPath(contractVersionId, "seal/approve"), body);
}

export function completeContractSeal(
  contractVersionId: string,
  body: CompleteContractSealPayload
) {
  return postJson<unknown>(governedContractPath(contractVersionId, "seal/complete"), body);
}

export function uploadMutuallySignedContract(
  contractVersionId: string,
  body: UploadMutuallySignedContractPayload
) {
  return postJson<unknown>(governedContractPath(contractVersionId, "formal-files/final"), body);
}

export function returnMutuallySignedContractForCorrection(
  contractVersionId: string,
  body: ReturnMutuallySignedContractPayload
) {
  return postJson<unknown>(
    governedContractPath(contractVersionId, "formal-files/final/return"),
    body
  );
}

export function confirmMutuallySignedContract(
  contractVersionId: string,
  body: ConfirmMutuallySignedContractPayload
) {
  return postJson<unknown>(
    governedContractPath(contractVersionId, "formal-files/final/confirmation"),
    body
  );
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

export interface RegenerateSettlementSignedDocumentPayload {
  confirmPureRenderingIssue: true;
  reason: string;
  confirmationPassword: string;
}

export function retrySettlementSignedDocumentGeneration(settlementId: string) {
  return postJson<SettlementSignedDocumentRecordReadModel | null>(
    `/settlements/${encodeURIComponent(settlementId)}/signed-document-generation-retry`
  );
}

export function regenerateSettlementSignedDocument(
  settlementId: string,
  body: RegenerateSettlementSignedDocumentPayload
) {
  return postJson<SettlementSignedDocumentRecordReadModel>(
    `/settlements/${encodeURIComponent(settlementId)}/signed-document-regeneration`,
    body
  );
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

export function abandonPaymentRequest(
  paymentId: string,
  body: { expectedUpdatedAt: string; reason: string }
) {
  return postJson<unknown>(
    `/payments/${encodeURIComponent(paymentId)}/abandonment`,
    body
  );
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

async function downloadWorkbook(
  path: string,
  fallbackFileName: string,
  fallbackError: string
): Promise<void> {
  const response = await apiFetch(path);
  await ensureOk(response, fallbackError);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : fallbackFileName;
  saveBlob(blob, fileName);
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

// 个人签名图：预上传后审批单渲染时复用。
export function uploadSignature(file: Blob, fileName: string) {
  const form = new FormData();
  form.append("file", file, fileName);
  return postForm<{ signatureFileId: string }>("/me/signature", form);
}

export function uploadCanvasSignature(file: Blob) {
  const form = new FormData();
  form.append("file", file, "手写签名.png");
  return postForm<{ signatureFileId: string; signatureVersionId: string }>("/me/signature/canvas", form);
}

export interface CanvasSignatureHandoffReadModel {
  expiresAt: string;
  completedAt: string | null;
  signatureVersionId: string | null;
}

export function createCanvasSignatureHandoff() {
  return postJson<{ token: string; expiresAt: string }>("/me/signature/canvas-handoffs");
}

export function getCanvasSignatureHandoff(token: string) {
  return readJson<CanvasSignatureHandoffReadModel>(`/me/signature/canvas-handoffs/${encodeURIComponent(token)}`);
}

export function completeCanvasSignatureHandoff(token: string, file: Blob) {
  const form = new FormData();
  form.append("file", file, "手写签名.png");
  return postForm<{ signatureFileId: string; signatureVersionId: string }>(
    `/me/signature/canvas-handoffs/${encodeURIComponent(token)}/complete`, form
  );
}

export function getSignatureTicket() {
  return readJson<(PrivateFileDownloadTicketReadModel & { signatureSource: "canvas" | "legacy" }) | null>("/me/signature/ticket");
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

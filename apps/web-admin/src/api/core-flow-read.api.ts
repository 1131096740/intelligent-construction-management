import type {
  ContractBusinessOptionReadModel,
  ContractApprovalWithdrawalContextReadModel,
  ContractWorkbenchLedgerPage,
  ContractWorkbenchView,
  ContractDetailReadModel,
  ContractSigningMaterialChangeStatus,
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
  SettlementApprovalWithdrawalContextReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import type { SettlementLineDraftPayload } from "./settlement-workbench.api";
import type { SettlementSignedDocumentRecordReadModel } from "./settlement-drafts.api";
import {
  ContractApprovalReviewResultUnknownError,
  ContractApprovalWithdrawalResultUnknownError
} from "../lib/contract-approval-result";
import { ContractSigningMaterialChangeResultUnknownError } from "../lib/contract-signing-material-change-result";
import { SettlementApprovalWithdrawalResultUnknownError } from "../lib/settlement-approval-result";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export class CoreFlowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "CoreFlowApiError";
  }
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `${fallback}：${response.status}`;
  let code: string | null = null;
  try {
    const data = (await response.clone().json()) as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof data.code === "string") {
      code = data.code;
    }
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
    message = formatApiErrorMessage(message, response.status, fallback);
  }

  throw new CoreFlowApiError(
    message,
    response.status,
    code
  );
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
  return readJson<ContractDetailReadModel>(
    `/contracts/${encodeURIComponent(contractId)}`
  );
}

export interface ContractSigningMaterialChangeActionContext {
  routeContractId: string;
  contractId: string;
  contractVersionId: string;
  expectedRevision: number;
  expectedSealTaskId: string;
  expectedStatus: ContractSigningMaterialChangeStatus;
}

export interface ContractSigningMaterialChangePayload {
  expectedRevision: number;
  expectedSealTaskId: string;
  expectedStatus: ContractSigningMaterialChangeStatus;
  reason: string;
}

export interface ContractSigningMaterialChangeResponse {
  status: "draft";
  draftRevision: number;
  requiresReapproval: true;
}

export interface ExecuteContractSigningMaterialChangeInput<
  TContext extends ContractSigningMaterialChangeActionContext
> {
  capture(): TContext | null;
  current(context: TContext, fresh?: ContractDetailReadModel): boolean;
  stale(context: TContext): void | Promise<void>;
  complete?(
    context: TContext,
    response: ContractSigningMaterialChangeResponse
  ): void | Promise<void>;
  fail?(context: TContext, error: unknown): void | Promise<void>;
  finish?(context: TContext): void | Promise<void>;
  reason: string | ((context: TContext) => string);
}

export type ExecuteContractSigningMaterialChangeResult<
  TContext extends ContractSigningMaterialChangeActionContext
> =
  | { status: "not_started" }
  | { status: "stale"; context: TContext }
  | { status: "failed"; context: TContext }
  | {
      status: "completed";
      context: TContext;
      response: ContractSigningMaterialChangeResponse;
    };

const MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS: Record<
  ContractSigningMaterialChangeStatus,
  string
> = {
  approved_pending_seal: "pending_approval",
  in_seal: "in_seal",
  seal_approved_pending_archive: "completed",
  pending_archive_confirm: "completed"
};

function assertContractSigningMaterialChangePreflight(
  context: ContractSigningMaterialChangeActionContext,
  fresh: ContractDetailReadModel
) {
  const enabledActions = fresh.availableActions.filter(
    (action) =>
      action.key === "report_signing_material_change" && action.enabled
  );
  const coordinates = fresh.signingMaterialChangeContext;
  if (
    fresh.id !== context.contractId ||
    fresh.contractVersionId !== context.contractVersionId ||
    fresh.draftRevision !== context.expectedRevision ||
    fresh.sealTask?.id !== context.expectedSealTaskId ||
    fresh.sealTask.status !==
      MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS[context.expectedStatus] ||
    enabledActions.length !== 1 ||
    coordinates?.expectedRevision !== context.expectedRevision ||
    coordinates.expectedSealTaskId !== context.expectedSealTaskId ||
    coordinates.expectedStatus !== context.expectedStatus
  ) {
    throw new Error(
      "合同签署状态已变化，未执行实质变化申报，请刷新详情后重试"
    );
  }
}

export async function executeContractSigningMaterialChange<
  TContext extends ContractSigningMaterialChangeActionContext
>(
  input: ExecuteContractSigningMaterialChangeInput<TContext>
): Promise<ExecuteContractSigningMaterialChangeResult<TContext>> {
  const context = input.capture();
  if (!context) return { status: "not_started" };
  try {
    if (!input.current(context)) {
      await input.stale(context);
      return { status: "stale", context };
    }

    const fresh = await fetchContractDetail(context.routeContractId);
    if (!input.current(context, fresh)) {
      await input.stale(context);
      return { status: "stale", context };
    }
    assertContractSigningMaterialChangePreflight(context, fresh);
    const reason = typeof input.reason === "function"
      ? input.reason(context)
      : input.reason;

    const payload: ContractSigningMaterialChangePayload = {
      expectedRevision: context.expectedRevision,
      expectedSealTaskId: context.expectedSealTaskId,
      expectedStatus: context.expectedStatus,
      reason
    };
    let response: ContractSigningMaterialChangeResponse;
    try {
      const rawResponse = await postJson<unknown>(
        governedContractPath(
          context.contractVersionId,
          "signing/material-change"
        ),
        payload
      );
      if (
        !rawResponse ||
        typeof rawResponse !== "object" ||
        (rawResponse as { status?: unknown }).status !== "draft" ||
        (rawResponse as { requiresReapproval?: unknown }).requiresReapproval !== true ||
        !Number.isInteger((rawResponse as { draftRevision?: unknown }).draftRevision) ||
        (rawResponse as { draftRevision: number }).draftRevision !==
          payload.expectedRevision + 1
      ) {
        throw new Error("服务端返回的退回重审结果与请求版本不一致");
      }
      response = rawResponse as ContractSigningMaterialChangeResponse;
    } catch (error) {
      if (error instanceof CoreFlowApiError) throw error;
      throw new ContractSigningMaterialChangeResultUnknownError(error);
    }
    if (!input.current(context, fresh)) {
      await input.stale(context);
      return { status: "stale", context };
    }
    await input.complete?.(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    if (!input.fail) throw error;
    await input.fail(context, error);
    return { status: "failed", context };
  } finally {
    await input.finish?.(context);
  }
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
  availableActions: Array<"create_contract_change_draft">;
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
  return readJson<SettlementDetailReadModel>(
    `/settlements/${encodeURIComponent(settlementId)}`
  );
}

export interface SettlementActionCapabilityReadModel {
  settlementId: string;
  availableActions: string[];
}

export function fetchSettlementActionCapability(settlementId: string) {
  return readJson<SettlementActionCapabilityReadModel>(
    `/settlements/${encodeURIComponent(settlementId)}/capability`
  );
}

export function fetchPaymentDetail(paymentId: string) {
  return readJson<PaymentLifecycleDetailReadModel>(`/payments/${encodeURIComponent(paymentId)}`);
}

export interface PaymentCreateCapabilityReadModel {
  projectId: string;
  availableActions: string[];
}

export function fetchPaymentCreateCapability(projectId: string) {
  return readJson<PaymentCreateCapabilityReadModel>(
    `/payments/create-capability?projectId=${encodeURIComponent(projectId)}`
  );
}

export interface PaymentActionCapabilityReadModel {
  paymentId: string;
  availableActions: string[];
}

export function fetchPaymentActionCapability(paymentId: string) {
  return readJson<PaymentActionCapabilityReadModel>(
    `/payments/${encodeURIComponent(paymentId)}/capability`
  );
}

export interface PaymentReviewApprovalContext {
  expectedPaymentUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export interface PaymentExecutionContext {
  expectedPaymentUpdatedAt: string;
}

export type PaymentLifecycleDetailReadModel = PaymentDetailReadModel & {
  lifecycleKind: "approval_draft" | "formal_record";
  ledgerView: DraftLedgerView;
  lifecycleUpdatedAt: string | null;
  reviewApprovalContext: PaymentReviewApprovalContext | null;
  executionContext: PaymentExecutionContext | null;
  blockedReasons: string[];
};

export function fetchContractPaymentApplication(contractVersionId: string) {
  const encodedContractVersionId = encodeURIComponent(contractVersionId);
  return readJson<ContractPaymentApplicationPreviewReadModel>(
    `/payments/contract-application?contractVersionId=${encodedContractVersionId}`
  );
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
  expectedPaymentUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export type PaymentApprovalReviewActionDecision = "approve" | "reject";

export interface PaymentApprovalReviewActionContext
  extends PaymentReviewApprovalContext {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  paymentId: string;
  decision: PaymentApprovalReviewActionDecision;
  requiresSelfReviewConfirmation: boolean;
  approvedAmountCents?: string;
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface PreparePaymentApprovalReviewActionInput
  extends PaymentApprovalReviewActionContext {
  isCurrent: (context: PaymentApprovalReviewActionContext) => boolean;
}

export type PreparePaymentApprovalReviewActionResult =
  | {
      status: "ready";
      context: PaymentApprovalReviewActionContext;
      preflight: PaymentLifecycleDetailReadModel;
    }
  | {
      status: "stale";
      context: PaymentApprovalReviewActionContext;
    };

export interface ExecutePaymentApprovalReviewActionInput {
  decision: PaymentApprovalReviewActionDecision;
  capture: (
    decision: PaymentApprovalReviewActionDecision
  ) => PaymentApprovalReviewActionContext | null;
  preflight: (
    context: PaymentApprovalReviewActionContext
  ) => Promise<PreparePaymentApprovalReviewActionResult>;
  current: (
    context: PaymentApprovalReviewActionContext,
    prepared: PreparePaymentApprovalReviewActionResult
  ) => boolean;
  complete: (
    context: PaymentApprovalReviewActionContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: PaymentApprovalReviewActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: PaymentApprovalReviewActionContext) => void;
}

export type ExecutePaymentApprovalReviewActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: PaymentApprovalReviewActionContext;
    }
  | {
      status: "completed";
      context: PaymentApprovalReviewActionContext;
      response: unknown;
    }
  | {
      status: "failed";
      context: PaymentApprovalReviewActionContext;
    };

export interface ReviewContractApprovalPayload {
  decision: "approve" | "reject";
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
  ownerContractRiskConfirmed?: boolean;
  expectedOwnerContractRisk?: ContractApprovalOwnerRiskSnapshot;
  expectedContractUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export interface ContractReviewApprovalCoordinates {
  expectedContractUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export type ContractApprovalReviewActionDecision = "approve" | "reject";

export type ContractApprovalOwnerRiskSnapshot = Readonly<
  NonNullable<ContractDetailReadModel["ownerContractRisk"]>
>;

export interface ContractApprovalReviewActionContext
  extends ContractReviewApprovalCoordinates {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  routeContractId: string;
  contractId: string;
  contractVersionId: string;
  decision: ContractApprovalReviewActionDecision;
  comment?: string;
  requiresSelfReviewConfirmation: boolean;
  selfReviewReason?: string;
  confirmationPassword?: string;
  ownerContractRisk: ContractApprovalOwnerRiskSnapshot | null;
  ownerContractRiskConfirmed: boolean;
}

export interface PrepareContractApprovalReviewActionInput
  extends ContractApprovalReviewActionContext {
  isCurrent: (context: ContractApprovalReviewActionContext) => boolean;
}

type ContractApprovalReviewPreflightReadModel = ContractDetailReadModel & {
  reviewApprovalContext?: ContractReviewApprovalCoordinates | null;
};

export type PrepareContractApprovalReviewActionResult =
  | {
      status: "ready";
      context: ContractApprovalReviewActionContext;
      preflight: ContractApprovalReviewPreflightReadModel;
    }
  | {
      status: "stale";
      context: ContractApprovalReviewActionContext;
    };

export interface ExecuteContractApprovalReviewActionInput {
  decision: ContractApprovalReviewActionDecision;
  capture: (
    decision: ContractApprovalReviewActionDecision
  ) => ContractApprovalReviewActionContext | null;
  preflight: (
    context: ContractApprovalReviewActionContext
  ) => Promise<PrepareContractApprovalReviewActionResult>;
  current: (
    context: ContractApprovalReviewActionContext,
    prepared: PrepareContractApprovalReviewActionResult
  ) => boolean;
  stale: (
    context: ContractApprovalReviewActionContext
  ) => void | Promise<void>;
  complete: (
    context: ContractApprovalReviewActionContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: ContractApprovalReviewActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: ContractApprovalReviewActionContext) => void;
}

export type ExecuteContractApprovalReviewActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: ContractApprovalReviewActionContext;
    }
  | {
      status: "completed";
      context: ContractApprovalReviewActionContext;
      response: unknown;
    }
  | {
      status: "failed";
      context: ContractApprovalReviewActionContext;
      error: unknown;
    };

export type ContractApprovalWithdrawalCoordinates =
  ContractApprovalWithdrawalContextReadModel;

export interface ContractApprovalWithdrawalActionContext
  extends ContractApprovalWithdrawalCoordinates {
  action: "withdraw";
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  routeContractId: string;
  contractId: string;
  contractVersionId: string;
}

export interface PrepareContractApprovalWithdrawalActionInput
  extends ContractApprovalWithdrawalActionContext {
  isCurrent: (
    context: ContractApprovalWithdrawalActionContext
  ) => boolean;
}

type ContractApprovalWithdrawalPreflightReadModel =
  ContractDetailReadModel;

export type PrepareContractApprovalWithdrawalActionResult =
  | {
      status: "ready";
      context: ContractApprovalWithdrawalActionContext;
      preflight: ContractApprovalWithdrawalPreflightReadModel;
    }
  | {
      status: "stale";
      context: ContractApprovalWithdrawalActionContext;
    };

export interface ExecuteContractApprovalWithdrawalActionInput {
  action: "withdraw";
  capture: (
    action: "withdraw"
  ) => ContractApprovalWithdrawalActionContext | null;
  preflight: (
    context: ContractApprovalWithdrawalActionContext
  ) => Promise<PrepareContractApprovalWithdrawalActionResult>;
  current: (
    context: ContractApprovalWithdrawalActionContext,
    prepared: PrepareContractApprovalWithdrawalActionResult
  ) => boolean;
  stale: (
    context: ContractApprovalWithdrawalActionContext
  ) => void | Promise<void>;
  complete: (
    context: ContractApprovalWithdrawalActionContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: ContractApprovalWithdrawalActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: ContractApprovalWithdrawalActionContext) => void;
}

export type ExecuteContractApprovalWithdrawalActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: ContractApprovalWithdrawalActionContext;
    }
  | {
      status: "completed";
      context: ContractApprovalWithdrawalActionContext;
      response: unknown;
    }
  | {
      status: "failed";
      context: ContractApprovalWithdrawalActionContext;
      error: unknown;
    };

export type SettlementApprovalWithdrawalCoordinates =
  SettlementApprovalWithdrawalContextReadModel;

export interface SettlementApprovalWithdrawalActionContext
  extends SettlementApprovalWithdrawalCoordinates {
  action: "withdraw";
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  routeSettlementId: string;
  settlementCode: string;
  settlementId: string;
}

export interface PrepareSettlementApprovalWithdrawalActionInput
  extends SettlementApprovalWithdrawalActionContext {
  isCurrent: (
    context: SettlementApprovalWithdrawalActionContext
  ) => boolean;
}

type SettlementApprovalWithdrawalPreflightReadModel =
  SettlementDetailReadModel;

export type PrepareSettlementApprovalWithdrawalActionResult =
  | {
      status: "ready";
      context: SettlementApprovalWithdrawalActionContext;
      preflight: SettlementApprovalWithdrawalPreflightReadModel;
    }
  | {
      status: "stale";
      context: SettlementApprovalWithdrawalActionContext;
    };

export interface ExecuteSettlementApprovalWithdrawalActionInput {
  action: "withdraw";
  capture: (
    action: "withdraw"
  ) => SettlementApprovalWithdrawalActionContext | null;
  preflight: (
    context: SettlementApprovalWithdrawalActionContext
  ) => Promise<PrepareSettlementApprovalWithdrawalActionResult>;
  current: (
    context: SettlementApprovalWithdrawalActionContext,
    prepared: PrepareSettlementApprovalWithdrawalActionResult
  ) => boolean;
  stale: (
    context: SettlementApprovalWithdrawalActionContext
  ) => void | Promise<void>;
  complete: (
    context: SettlementApprovalWithdrawalActionContext,
    response: SettlementApprovalWithdrawalResponse
  ) => void | Promise<void>;
  fail: (
    context: SettlementApprovalWithdrawalActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: SettlementApprovalWithdrawalActionContext) => void;
}

export interface SettlementApprovalWithdrawalResponse {
  id: string;
  status: "withdrawn";
}

export type ExecuteSettlementApprovalWithdrawalActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: SettlementApprovalWithdrawalActionContext;
    }
  | {
      status: "completed";
      context: SettlementApprovalWithdrawalActionContext;
      response: SettlementApprovalWithdrawalResponse;
    }
  | {
      status: "failed";
      context: SettlementApprovalWithdrawalActionContext;
      error: unknown;
    };

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
  expectedPaymentUpdatedAt: string;
  idempotencyKey: string;
}

export interface RecordPaymentExecutionWithUploadInput<TContext> {
  amountCents: string;
  paidAt: string;
  confirmationPassword: string;
  expectedPaymentUpdatedAt: string;
  idempotencyKey: string;
  file: Blob;
  fileName: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface PaymentExecutionRecordSubmission {
  paymentId: string;
  amountCents: string;
  paidAt: string;
  confirmationPassword: string;
  expectedPaymentUpdatedAt: string;
  idempotencyKey: string;
  file: Blob;
  fileName: string;
  isCurrent: () => boolean;
}

export interface PaymentExecutionRecordAttemptState {
  submission: PaymentExecutionRecordSubmission | null;
  confirmationPasswordRejected: boolean;
  preflightVerified: boolean;
  preflightPromise: Promise<PaymentLifecycleDetailReadModel> | null;
  uploadedFileId: string | null;
  uploadPromise: Promise<PrivateFileReadModel> | null;
  requestPromise: Promise<unknown> | null;
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
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export interface VoidProjectExpenseRequestPayload {
  reason: string;
}

export interface RecordProjectExpenseExecutionPayload {
  amountCents: string;
  paidAt: string;
  voucherFileId: string;
  confirmationPassword: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
}

export interface ProjectExpenseExecutionContext {
  expectedExpenseUpdatedAt: string;
}

export interface RecordProjectExpenseExecutionWithUploadInput<TContext> {
  amountCents: string;
  paidAt: string;
  confirmationPassword: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  file: Blob;
  fileName: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface ProjectExpenseExecutionRecordSubmission {
  projectId: string;
  expenseRequestId: string;
  amountCents: string;
  paidAt: string;
  confirmationPassword: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  file: Blob;
  fileName: string;
  isCurrent: () => boolean;
}

export interface ProjectExpenseExecutionRecordAttemptState {
  submission: ProjectExpenseExecutionRecordSubmission | null;
  confirmationPasswordRejected: boolean;
  preflightVerified: boolean;
  preflightPromise: Promise<ProjectExpenseApprovalLifecycleDetailReadModel> | null;
  uploadedFileId: string | null;
  uploadPromise: Promise<PrivateFileReadModel> | null;
  requestPromise: Promise<unknown> | null;
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
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
}

export interface ProjectExpenseFinanceContext {
  expectedExpenseUpdatedAt: string;
}

export interface ProjectExpenseFinanceRecordReadModel {
  id: string;
  idempotencyKey: string;
  projectId: string;
  projectExpenseRequestId: string;
  paymentRequestId: null;
  settlementId: null;
  direction: "outflow";
  amountCents: string;
  occurredAt: string;
  createdByUserId: string;
}

export interface RecordProjectExpenseFinanceWithPreflightInput<TContext> {
  amountCents: string;
  occurredAt: string;
  confirmationPassword: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface ProjectExpenseFinanceRecordSubmission {
  projectId: string;
  expenseRequestId: string;
  amountCents: string;
  occurredAt: string;
  confirmationPassword: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  isCurrent: () => boolean;
}

export interface ProjectExpenseFinanceRecordAttemptState {
  submission: ProjectExpenseFinanceRecordSubmission | null;
  confirmationPasswordRejected: boolean;
  preflightVerified: boolean;
  preflightPromise:
    | Promise<ProjectExpenseApprovalLifecycleDetailReadModel>
    | null;
  requestPromise:
    | Promise<ProjectExpenseFinanceRecordReadModel>
    | null;
}

export interface ProjectExpenseFinanceCompletionBaseline {
  projectId: string;
  expenseRequestId: string;
  expectedExpenseUpdatedAt: string;
  expectedPaidAmountCents: string;
  expectedFinanceRecordedAmountCents: string;
  expectedFinanceRemainingAmountCents: string;
  amountCents: string;
}

export interface ConfirmProjectExpenseReceiptPayload {
  confirmationPassword: string;
  note?: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
}

export interface ProjectExpenseReceiptConfirmationReadModel {
  projectId: string;
  expenseRequestId: string;
  idempotencyKey: string;
  confirmedByUserId: string;
  confirmedAt: string;
  note: string | null;
  updatedAt: string;
}

export interface ConfirmProjectExpenseReceiptWithPreflightInput<TContext> {
  confirmationPassword: string;
  note?: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface ProjectExpenseReceiptConfirmationSubmission {
  projectId: string;
  expenseRequestId: string;
  confirmationPassword: string;
  note?: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  isCurrent: () => boolean;
}

export interface ProjectExpenseReceiptConfirmationAttemptState {
  submission: ProjectExpenseReceiptConfirmationSubmission | null;
  confirmationPasswordRejected: boolean;
  preflightVerified: boolean;
  preflightPromise:
    | Promise<ProjectExpenseApprovalLifecycleDetailReadModel>
    | null;
  requestPromise:
    | Promise<ProjectExpenseReceiptConfirmationReadModel>
    | null;
}

export interface ProjectExpenseReceiptCompletionBaseline {
  projectId: string;
  expenseRequestId: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
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

export interface ProjectActionCapabilityReadModel {
  projectId?: string;
  availableActions: string[];
}

export function fetchProjectCreateCapability() {
  return readJson<ProjectActionCapabilityReadModel>("/projects/create-capability");
}

export function updateProject(projectId: string, body: UpdateProjectPayload) {
  return patchJson<ProjectOptionReadModel>(`/projects/${projectId}`, body);
}

export function fetchProjectUpdateCapability(projectId: string) {
  return readJson<ProjectActionCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/update-capability`
  );
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

export function fetchProjectUpstreamFundRecordCapability(projectId: string) {
  return readJson<ProjectActionCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/upstream-fund-facts/record-capability`
  );
}

export interface ProjectUpstreamFundConfirmationCapabilityReadModel
  extends ProjectActionCapabilityReadModel {
  projectId: string;
  fundFactId: string;
}

export function fetchProjectUpstreamFundConfirmationCapability(
  projectId: string,
  fundFactId: string
) {
  return readJson<ProjectUpstreamFundConfirmationCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/upstream-fund-facts/${encodeURIComponent(fundFactId)}/confirmation-capability`
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

export interface ProjectAffiliateRecordCapabilityReadModel {
  projectId: string;
  businessType: ProjectAffiliateBusinessFactType;
  entryKind: ProjectAffiliateEntryKind;
  adjustsFactId: string | null;
  availableActions: string[];
}

export function fetchProjectAffiliateRecordCapability(
  projectId: string,
  businessType: ProjectAffiliateBusinessFactType,
  entryKind: ProjectAffiliateEntryKind,
  adjustsFactId?: string
) {
  const query = new URLSearchParams({ businessType, entryKind });
  if (adjustsFactId) query.set("adjustsFactId", adjustsFactId);
  return readJson<ProjectAffiliateRecordCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-business-facts/record-capability?${query.toString()}`
  );
}

export interface ProjectAffiliateFactCapabilityReadModel {
  projectId: string;
  factId: string;
  businessType: ProjectAffiliateBusinessFactType;
  availableActions: string[];
}

export function fetchProjectAffiliateFactCapability(
  projectId: string,
  businessType: ProjectAffiliateBusinessFactType,
  factId: string
) {
  return readJson<ProjectAffiliateFactCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-business-facts/${encodeURIComponent(factId)}/capability?businessType=${encodeURIComponent(businessType)}`
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

export function createProjectExpenseRequest(
  projectId: string,
  body: CreateProjectExpenseRequestPayload
) {
  return postJson<unknown>(`/projects/${projectId}/expense-requests`, body);
}

export function fetchProjectExpenseCreateCapability(projectId: string) {
  return readJson<ProjectActionCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/create-capability`
  );
}

export interface ProjectExpenseActionCapabilityReadModel
  extends ProjectActionCapabilityReadModel {
  projectId: string;
  expenseRequestId: string;
}

export function fetchProjectExpenseActionCapability(
  projectId: string,
  expenseRequestId: string
) {
  return readJson<ProjectExpenseActionCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/${encodeURIComponent(expenseRequestId)}/capability`
  );
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
    reviewApprovalContext: ProjectExpenseReviewApprovalCoordinates | null;
    withdrawalContext: ProjectExpenseWithdrawalCoordinates | null;
    executionContext: ProjectExpenseExecutionContext | null;
    financeContext: ProjectExpenseFinanceContext | null;
  };

export interface ProjectExpenseReviewApprovalCoordinates {
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export type ProjectExpenseApprovalReviewActionDecision = "approve" | "reject";

export interface ProjectExpenseApprovalReviewActionContext
  extends ProjectExpenseReviewApprovalCoordinates {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  projectId: string;
  expenseRequestId: string;
  decision: ProjectExpenseApprovalReviewActionDecision;
  requiresSelfReviewConfirmation: boolean;
  approvedAmountCents?: string;
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface PrepareProjectExpenseApprovalReviewActionInput
  extends ProjectExpenseApprovalReviewActionContext {
  isCurrent: (
    context: ProjectExpenseApprovalReviewActionContext
  ) => boolean;
}

export type PrepareProjectExpenseApprovalReviewActionResult =
  | {
      status: "ready";
      context: ProjectExpenseApprovalReviewActionContext;
      preflight: ProjectExpenseApprovalLifecycleDetailReadModel;
    }
  | {
      status: "stale";
      context: ProjectExpenseApprovalReviewActionContext;
    };

export interface ExecuteProjectExpenseApprovalReviewActionInput {
  decision: ProjectExpenseApprovalReviewActionDecision;
  capture: (
    decision: ProjectExpenseApprovalReviewActionDecision
  ) => ProjectExpenseApprovalReviewActionContext | null;
  preflight: (
    context: ProjectExpenseApprovalReviewActionContext
  ) => Promise<PrepareProjectExpenseApprovalReviewActionResult>;
  current: (
    context: ProjectExpenseApprovalReviewActionContext,
    prepared: PrepareProjectExpenseApprovalReviewActionResult
  ) => boolean;
  complete: (
    context: ProjectExpenseApprovalReviewActionContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: ProjectExpenseApprovalReviewActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: ProjectExpenseApprovalReviewActionContext) => void;
}

export type ExecuteProjectExpenseApprovalReviewActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: ProjectExpenseApprovalReviewActionContext;
    }
  | {
      status: "completed";
      context: ProjectExpenseApprovalReviewActionContext;
      response: unknown;
    }
  | {
      status: "failed";
      context: ProjectExpenseApprovalReviewActionContext;
      error: unknown;
    };

export interface ProjectExpenseWithdrawalCoordinates {
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
}

export interface ProjectExpenseWithdrawalActionContext
  extends ProjectExpenseWithdrawalCoordinates {
  action: "withdraw";
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  projectId: string;
  expenseRequestId: string;
}

export interface PrepareProjectExpenseWithdrawalActionInput
  extends ProjectExpenseWithdrawalActionContext {
  isCurrent: (context: ProjectExpenseWithdrawalActionContext) => boolean;
}

export type PrepareProjectExpenseWithdrawalActionResult =
  | {
      status: "ready";
      context: ProjectExpenseWithdrawalActionContext;
      preflight: ProjectExpenseApprovalLifecycleDetailReadModel;
    }
  | {
      status: "stale";
      context: ProjectExpenseWithdrawalActionContext;
    };

export interface ExecuteProjectExpenseWithdrawalActionInput {
  action: "withdraw";
  capture: (
    action: "withdraw"
  ) => ProjectExpenseWithdrawalActionContext | null;
  preflight: (
    context: ProjectExpenseWithdrawalActionContext
  ) => Promise<PrepareProjectExpenseWithdrawalActionResult>;
  current: (
    context: ProjectExpenseWithdrawalActionContext,
    prepared: PrepareProjectExpenseWithdrawalActionResult
  ) => boolean;
  complete: (
    context: ProjectExpenseWithdrawalActionContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: ProjectExpenseWithdrawalActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: ProjectExpenseWithdrawalActionContext) => void;
}

export type ExecuteProjectExpenseWithdrawalActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: ProjectExpenseWithdrawalActionContext;
    }
  | {
      status: "completed";
      context: ProjectExpenseWithdrawalActionContext;
      response: unknown;
    }
  | {
      status: "failed";
      context: ProjectExpenseWithdrawalActionContext;
      error: unknown;
    };

export async function prepareProjectExpenseApprovalReviewAction(
  input: PrepareProjectExpenseApprovalReviewActionInput
): Promise<PrepareProjectExpenseApprovalReviewActionResult> {
  const context = normalizeProjectExpenseApprovalReviewAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchProjectExpenseApprovalDetail(
    context.projectId,
    context.expenseRequestId
  );
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertProjectExpenseApprovalReviewPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeProjectExpenseApprovalReviewAction(
  input: ExecuteProjectExpenseApprovalReviewActionInput
): Promise<ExecuteProjectExpenseApprovalReviewActionResult> {
  const context = input.capture(input.decision);
  if (!context) return { status: "not_started" };

  try {
    const prepared = await input.preflight(context);
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    const response = await postJson<unknown>(
      `/projects/${encodeURIComponent(context.projectId)}/expense-requests/${encodeURIComponent(context.expenseRequestId)}/approval`,
      projectExpenseApprovalReviewActionPayload(context, input.decision)
    );
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    await input.complete(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context, error };
  } finally {
    input.finish(context);
  }
}

function projectExpenseApprovalReviewActionPayload(
  context: ProjectExpenseApprovalReviewActionContext,
  decision: ProjectExpenseApprovalReviewActionDecision
): ReviewProjectExpenseApprovalPayload {
  if (
    context.decision !== decision ||
    (decision === "reject" && !context.comment) ||
    (context.requiresSelfReviewConfirmation &&
      (!context.selfReviewReason || !context.confirmationPassword?.trim()))
  ) {
    throw new Error(
      "项目支出审批上下文无效，请重新读取当前申请后再操作"
    );
  }

  return {
    decision,
    ...(decision === "approve" && context.approvedAmountCents
      ? { approvedAmountCents: context.approvedAmountCents }
      : {}),
    ...(context.comment ? { comment: context.comment } : {}),
    ...(context.requiresSelfReviewConfirmation
      ? {
          selfReviewReason: context.selfReviewReason,
          confirmationPassword: context.confirmationPassword
        }
      : {}),
    expectedExpenseUpdatedAt: context.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
}

function normalizeProjectExpenseApprovalReviewAction(
  input: PrepareProjectExpenseApprovalReviewActionInput
): ProjectExpenseApprovalReviewActionContext {
  const ownerScope = input.ownerScope.trim();
  const projectId = input.projectId.trim();
  const expenseRequestId = input.expenseRequestId.trim();
  const expectedExpenseUpdatedAt = input.expectedExpenseUpdatedAt.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const expectedApprovalUpdatedAt =
    input.expectedApprovalUpdatedAt.trim();
  const approvedAmountCents =
    input.decision === "approve"
      ? input.approvedAmountCents?.trim() || undefined
      : undefined;
  const comment = input.comment?.trim() || undefined;
  const selfReviewReason = input.requiresSelfReviewConfirmation
    ? input.selfReviewReason?.trim() || undefined
    : undefined;
  const confirmationPassword = input.requiresSelfReviewConfirmation
    ? input.confirmationPassword
    : undefined;
  if (
    !ownerScope ||
    !projectId ||
    !expenseRequestId ||
    !expectedExpenseUpdatedAt ||
    !expectedApprovalInstanceId ||
    !expectedApprovalUpdatedAt ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0 ||
    (input.decision !== "approve" && input.decision !== "reject") ||
    (approvedAmountCents !== undefined &&
      !/^(?:0|[1-9]\d*)$/.test(approvedAmountCents)) ||
    (input.decision === "reject" && !comment) ||
    (input.requiresSelfReviewConfirmation &&
      (!selfReviewReason || !confirmationPassword?.trim()))
  ) {
    throw new Error(
      "项目支出审批上下文无效，请重新读取当前申请后再操作"
    );
  }

  return Object.freeze({
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    projectId,
    expenseRequestId,
    expectedExpenseUpdatedAt,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt,
    decision: input.decision,
    requiresSelfReviewConfirmation:
      input.requiresSelfReviewConfirmation,
    ...(approvedAmountCents ? { approvedAmountCents } : {}),
    ...(comment ? { comment } : {}),
    ...(selfReviewReason ? { selfReviewReason } : {}),
    ...(confirmationPassword ? { confirmationPassword } : {})
  });
}

function assertProjectExpenseApprovalReviewPreflight(
  context: ProjectExpenseApprovalReviewActionContext,
  preflight: ProjectExpenseApprovalLifecycleDetailReadModel
) {
  const enabledReviewActions = preflight.availableActions.filter(
    (action) => action.key === "review_approval" && action.enabled
  );
  const reviewAction = enabledReviewActions[0];
  const coordinates = preflight.reviewApprovalContext;
  if (
    preflight.projectId !== context.projectId ||
    preflight.id !== context.expenseRequestId ||
    preflight.lifecycleUpdatedAt !== context.expectedExpenseUpdatedAt ||
    enabledReviewActions.length !== 1 ||
    reviewAction?.requiresSelfReviewConfirmation !==
      context.requiresSelfReviewConfirmation ||
    coordinates?.expectedExpenseUpdatedAt !==
      context.expectedExpenseUpdatedAt ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex ||
    coordinates.expectedApprovalUpdatedAt !==
      context.expectedApprovalUpdatedAt
  ) {
    throw new Error(
      "项目支出审批资格或坐标已变化，请重新读取当前申请"
    );
  }
}

export async function prepareProjectExpenseWithdrawalAction(
  input: PrepareProjectExpenseWithdrawalActionInput
): Promise<PrepareProjectExpenseWithdrawalActionResult> {
  const context = normalizeProjectExpenseWithdrawalAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchProjectExpenseApprovalDetail(
    context.projectId,
    context.expenseRequestId
  );
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertProjectExpenseWithdrawalPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeProjectExpenseWithdrawalAction(
  input: ExecuteProjectExpenseWithdrawalActionInput
): Promise<ExecuteProjectExpenseWithdrawalActionResult> {
  const context = input.capture(input.action);
  if (!context) return { status: "not_started" };

  try {
    const prepared = await input.preflight(context);
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    const response = await postJson<unknown>(
      `/projects/${encodeURIComponent(context.projectId)}/expense-requests/${encodeURIComponent(context.expenseRequestId)}/approval-withdrawal`,
      projectExpenseWithdrawalPayload(context)
    );
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    await input.complete(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context, error };
  } finally {
    input.finish(context);
  }
}

function projectExpenseWithdrawalPayload(
  context: ProjectExpenseWithdrawalActionContext
): ProjectExpenseWithdrawalCoordinates {
  if (context.action !== "withdraw") {
    throw new Error("项目支出撤回上下文无效，请重新读取当前申请");
  }
  return {
    expectedExpenseUpdatedAt: context.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
}

function normalizeProjectExpenseWithdrawalAction(
  input: PrepareProjectExpenseWithdrawalActionInput
): ProjectExpenseWithdrawalActionContext {
  const ownerScope = input.ownerScope.trim();
  const projectId = input.projectId.trim();
  const expenseRequestId = input.expenseRequestId.trim();
  const expectedExpenseUpdatedAt =
    input.expectedExpenseUpdatedAt.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const expectedApprovalUpdatedAt =
    input.expectedApprovalUpdatedAt.trim();
  if (
    input.action !== "withdraw" ||
    !ownerScope ||
    !projectId ||
    !expenseRequestId ||
    !expectedExpenseUpdatedAt ||
    !expectedApprovalInstanceId ||
    !expectedApprovalUpdatedAt ||
    Number.isNaN(new Date(expectedExpenseUpdatedAt).getTime()) ||
    Number.isNaN(new Date(expectedApprovalUpdatedAt).getTime()) ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0
  ) {
    throw new Error("项目支出撤回上下文无效，请重新读取当前申请");
  }

  return Object.freeze({
    action: "withdraw",
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    projectId,
    expenseRequestId,
    expectedExpenseUpdatedAt,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt
  });
}

function assertProjectExpenseWithdrawalPreflight(
  context: ProjectExpenseWithdrawalActionContext,
  preflight: ProjectExpenseApprovalLifecycleDetailReadModel
) {
  const enabledWithdrawActions = preflight.availableActions.filter(
    (action) => action.key === "withdraw" && action.enabled
  );
  const coordinates = preflight.withdrawalContext;
  if (
    preflight.projectId !== context.projectId ||
    preflight.id !== context.expenseRequestId ||
    preflight.lifecycleUpdatedAt !== context.expectedExpenseUpdatedAt ||
    enabledWithdrawActions.length !== 1 ||
    coordinates?.expectedExpenseUpdatedAt !==
      context.expectedExpenseUpdatedAt ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex ||
    coordinates.expectedApprovalUpdatedAt !==
      context.expectedApprovalUpdatedAt
  ) {
    throw new Error(
      "项目支出撤回资格或坐标已变化，请重新读取当前申请"
    );
  }
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
    `/projects/${encodeURIComponent(projectId)}/expense-requests/${encodeURIComponent(expenseRequestId)}/executions`,
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
  return postJson<ProjectExpenseFinanceRecordReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/${encodeURIComponent(expenseRequestId)}/finance-records`,
    body
  );
}

function confirmProjectExpenseReceipt(
  projectId: string,
  expenseRequestId: string,
  body: ConfirmProjectExpenseReceiptPayload
) {
  return postJson<ProjectExpenseReceiptConfirmationReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/${encodeURIComponent(expenseRequestId)}/receipt-confirmation`,
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
  contractId?: string;
  contractVersionId?: string;
  projectId?: string;
  source?: "system" | "historical_takeover";
  changeType?: string | null;
  historicalTakeoverFlow?: boolean;
  takeoverId?: string | null;
  takeoverStatus?: string | null;
  takeoverReadable?: boolean;
  takeoverRelationMismatch?: boolean;
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

function projectDomainPrivateFileForm(
  file: Blob,
  fileName: string,
  fields?: Record<string, string>,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  for (const [key, value] of Object.entries(fields ?? {})) {
    form.append(key, value);
  }
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  return form;
}

export function uploadProjectExpensePrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

export function uploadProjectExpenseExecutionPrivateFile(
  projectId: string,
  expenseRequestId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/expense-requests/${encodeURIComponent(expenseRequestId)}/execution-voucher-file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

export function uploadProjectUpstreamFundPrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/upstream-fund-facts/file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

export function uploadProjectAffiliateBusinessPrivateFile(
  projectId: string,
  businessType: ProjectAffiliateBusinessFactType,
  factId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-business-facts/${encodeURIComponent(factId)}/evidence-file-uploads`,
    projectDomainPrivateFileForm(file, fileName, { businessType }, idempotencyKey)
  );
}

export function uploadProjectAffiliateContractPrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-contract-facts/file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

export function uploadProjectAffiliateCompanyContractPrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-company-contracts/file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

export function uploadProjectAffiliateSettlementPrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-settlement-facts/file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

export function uploadProjectAffiliatePaymentPrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/affiliate-payment-facts/file-uploads`,
    projectDomainPrivateFileForm(file, fileName, undefined, idempotencyKey)
  );
}

function uploadSettlementPrivateFile(
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
  return postForm<PrivateFileReadModel>(path, form);
}

export function uploadSettlementArchivePrivateFile(
  settlementId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSettlementPrivateFile(
    `/settlements/${encodeURIComponent(settlementId)}/archive-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSettlementRecoveryPrivateFile(
  settlementId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSettlementPrivateFile(
    `/settlements/${encodeURIComponent(settlementId)}/recovery-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadPaymentPdfArchivePrivateFile(
  paymentId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  return postForm<PrivateFileReadModel>(
    `/payments/${encodeURIComponent(paymentId)}/pdf-archive-file-uploads`,
    form
  );
}

export function uploadPaymentExecutionPrivateFile(
  paymentId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  return postForm<PrivateFileReadModel>(
    `/payments/${encodeURIComponent(paymentId)}/execution-voucher-file-uploads`,
    form
  );
}

export function createPaymentExecutionRecordAttemptState(): PaymentExecutionRecordAttemptState {
  return {
    submission: null,
    confirmationPasswordRejected: false,
    preflightVerified: false,
    preflightPromise: null,
    uploadedFileId: null,
    uploadPromise: null,
    requestPromise: null
  };
}

export function recordPaymentExecutionWithUpload<TContext>(
  paymentId: string,
  input: RecordPaymentExecutionWithUploadInput<TContext>,
  state: PaymentExecutionRecordAttemptState
) {
  if (state.requestPromise) return state.requestPromise;
  let submission: PaymentExecutionRecordSubmission;
  try {
    const existingSubmission = state.submission;
    submission =
      existingSubmission && state.confirmationPasswordRejected
        ? Object.freeze({
            ...existingSubmission,
            confirmationPassword:
              requiredPaymentExecutionText(
                input.confirmationPassword,
                "当前密码",
                false
              )
          })
        : existingSubmission ??
          normalizePaymentExecutionRecord(paymentId, input);
    if (submission.paymentId !== paymentId.trim()) {
      throw new Error(
        "实际付款重试单据已变化，请重新打开确认窗口"
      );
    }
    state.submission = submission;
    state.confirmationPasswordRejected = false;
  } catch (error) {
    return Promise.reject(error);
  }

  const request = executePaymentExecutionRecord(
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

function normalizePaymentExecutionRecord<TContext>(
  paymentId: string,
  input: RecordPaymentExecutionWithUploadInput<TContext>
): PaymentExecutionRecordSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error(
      "实际付款上下文已失效，请重新读取当前单据"
    );
  }
  if (!(input.file instanceof Blob)) {
    throw new Error("付款凭证文件不能为空");
  }
  const normalizedIdempotencyKey =
    requiredPaymentExecutionText(
      input.idempotencyKey,
      "实际付款幂等键"
    ).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      normalizedIdempotencyKey
    )
  ) {
    throw new Error("实际付款幂等键必须为 UUIDv4");
  }
  const amountCents = requiredPaymentExecutionText(
    input.amountCents,
    "实付金额"
  );
  if (!/^[1-9]\d*$/u.test(amountCents)) {
    throw new Error("实付金额必须为正整数分");
  }
  const paidAt = requiredPaymentExecutionText(
    input.paidAt,
    "付款时间"
  );
  if (Number.isNaN(new Date(paidAt).getTime())) {
    throw new Error("付款时间格式不正确");
  }
  return Object.freeze({
    paymentId: requiredPaymentExecutionText(
      paymentId,
      "付款编号"
    ),
    amountCents,
    paidAt,
    confirmationPassword: requiredPaymentExecutionText(
      input.confirmationPassword,
      "当前密码",
      false
    ),
    expectedPaymentUpdatedAt:
      requiredPaymentExecutionText(
        input.expectedPaymentUpdatedAt,
        "付款版本"
      ),
    idempotencyKey: normalizedIdempotencyKey,
    file: input.file,
    fileName: requiredPaymentExecutionText(
      input.fileName,
      "付款凭证文件名"
    ),
    isCurrent: () => input.isCurrent(input.context)
  });
}

async function executePaymentExecutionRecord(
  submission: PaymentExecutionRecordSubmission,
  state: PaymentExecutionRecordAttemptState
) {
  assertPaymentExecutionCurrent(submission);
  await verifyPaymentExecutionPreflight(submission, state);
  assertPaymentExecutionCurrent(submission);

  let fileId = state.uploadedFileId;
  if (fileId === null) {
    const upload =
      state.uploadPromise ??
      uploadPaymentExecutionPrivateFile(
        submission.paymentId,
        submission.file,
        submission.fileName,
        submission.idempotencyKey
      );
    state.uploadPromise = upload;
    try {
      const uploaded = await upload;
      assertPaymentExecutionCurrent(submission);
      if (uploaded.id !== submission.idempotencyKey) {
        throw new Error(
          "付款凭证上传幂等响应不一致，请刷新后重试"
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
  assertPaymentExecutionCurrent(submission);

  let response: unknown;
  try {
    response = await recordPaymentExecution(
      submission.paymentId,
      {
        amountCents: submission.amountCents,
        paidAt: submission.paidAt,
        voucherFileId: fileId,
        confirmationPassword:
          submission.confirmationPassword,
        expectedPaymentUpdatedAt:
          submission.expectedPaymentUpdatedAt,
        idempotencyKey: submission.idempotencyKey
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("当前密码不正确")
    ) {
      state.confirmationPasswordRejected = true;
    }
    throw error;
  }
  assertPaymentExecutionCurrent(submission);
  return response;
}

async function verifyPaymentExecutionPreflight(
  submission: PaymentExecutionRecordSubmission,
  state: PaymentExecutionRecordAttemptState
) {
  if (state.preflightVerified) return;
  const preflight =
    state.preflightPromise ??
    fetchPaymentDetail(submission.paymentId);
  state.preflightPromise = preflight;
  let detail: PaymentLifecycleDetailReadModel;
  try {
    detail = await preflight;
  } catch (error) {
    if (state.preflightPromise === preflight) {
      state.preflightPromise = null;
    }
    throw error;
  }
  assertPaymentExecutionCurrent(submission);
  const enabledActions = detail.availableActions.filter(
    (action) =>
      action.key === "record_execution" && action.enabled
  );
  if (
    detail.id !== submission.paymentId ||
    enabledActions.length !== 1 ||
    detail.lifecycleUpdatedAt !==
      submission.expectedPaymentUpdatedAt ||
    detail.executionContext
      ?.expectedPaymentUpdatedAt !==
      submission.expectedPaymentUpdatedAt
  ) {
    state.preflightPromise = null;
    throw new Error(
      "付款执行资格或版本已变化，请刷新详情后重试"
    );
  }
  state.preflightVerified = true;
}

function assertPaymentExecutionCurrent(
  submission: PaymentExecutionRecordSubmission
) {
  if (!submission.isCurrent()) {
    throw new Error(
      "实际付款上下文已失效，请重新读取当前单据"
    );
  }
}

function requiredPaymentExecutionText(
  value: string,
  label: string,
  trim = true
) {
  const normalized = trim ? value.trim() : value;
  if (!normalized.trim()) throw new Error(`请填写${label}`);
  return normalized;
}

export function createProjectExpenseExecutionRecordAttemptState(): ProjectExpenseExecutionRecordAttemptState {
  return {
    submission: null,
    confirmationPasswordRejected: false,
    preflightVerified: false,
    preflightPromise: null,
    uploadedFileId: null,
    uploadPromise: null,
    requestPromise: null
  };
}

export function recordProjectExpenseExecutionWithUpload<TContext>(
  projectId: string,
  expenseRequestId: string,
  input: RecordProjectExpenseExecutionWithUploadInput<TContext>,
  state: ProjectExpenseExecutionRecordAttemptState
) {
  if (state.requestPromise) return state.requestPromise;
  let submission: ProjectExpenseExecutionRecordSubmission;
  try {
    const existingSubmission = state.submission;
    submission =
      existingSubmission && state.confirmationPasswordRejected
        ? Object.freeze({
            ...existingSubmission,
            confirmationPassword: requiredProjectExpenseExecutionText(
              input.confirmationPassword,
              "当前密码",
              false
            )
          })
        : existingSubmission ??
          normalizeProjectExpenseExecutionRecord(
            projectId,
            expenseRequestId,
            input
          );
    if (
      submission.projectId !== projectId.trim() ||
      submission.expenseRequestId !== expenseRequestId.trim()
    ) {
      throw new Error(
        "项目支出实付重试单据已变化，请重新打开确认窗口"
      );
    }
    state.submission = submission;
    state.confirmationPasswordRejected = false;
  } catch (error) {
    return Promise.reject(error);
  }

  const request = executeProjectExpenseExecutionRecord(
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

function normalizeProjectExpenseExecutionRecord<TContext>(
  projectId: string,
  expenseRequestId: string,
  input: RecordProjectExpenseExecutionWithUploadInput<TContext>
): ProjectExpenseExecutionRecordSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error(
      "项目支出实付上下文已失效，请重新读取当前单据"
    );
  }
  if (!(input.file instanceof Blob)) {
    throw new Error("项目支出实付凭证不能为空");
  }
  const normalizedIdempotencyKey =
    requiredProjectExpenseExecutionText(
      input.idempotencyKey,
      "项目支出实付幂等键"
    ).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      normalizedIdempotencyKey
    )
  ) {
    throw new Error("项目支出实付幂等键必须为 UUIDv4");
  }
  const amountCents = requiredProjectExpenseExecutionText(
    input.amountCents,
    "实付金额"
  );
  if (!/^[1-9]\d*$/u.test(amountCents)) {
    throw new Error("实付金额必须为正整数分");
  }
  const paidAt = requiredProjectExpenseExecutionText(
    input.paidAt,
    "实付时间"
  );
  if (Number.isNaN(new Date(paidAt).getTime())) {
    throw new Error("实付时间格式不正确");
  }
  return Object.freeze({
    projectId: requiredProjectExpenseExecutionText(
      projectId,
      "项目编号"
    ),
    expenseRequestId: requiredProjectExpenseExecutionText(
      expenseRequestId,
      "项目支出编号"
    ),
    amountCents,
    paidAt,
    confirmationPassword: requiredProjectExpenseExecutionText(
      input.confirmationPassword,
      "当前密码",
      false
    ),
    expectedExpenseUpdatedAt:
      requiredProjectExpenseExecutionText(
        input.expectedExpenseUpdatedAt,
        "项目支出版本"
      ),
    idempotencyKey: normalizedIdempotencyKey,
    file: input.file,
    fileName: requiredProjectExpenseExecutionText(
      input.fileName,
      "项目支出实付凭证文件名"
    ),
    isCurrent: () => input.isCurrent(input.context)
  });
}

async function executeProjectExpenseExecutionRecord(
  submission: ProjectExpenseExecutionRecordSubmission,
  state: ProjectExpenseExecutionRecordAttemptState
): Promise<unknown> {
  assertProjectExpenseExecutionCurrent(submission);
  await verifyProjectExpenseExecutionPreflight(submission, state);
  assertProjectExpenseExecutionCurrent(submission);

  let fileId = state.uploadedFileId;
  if (fileId === null) {
    const upload =
      state.uploadPromise ??
      uploadProjectExpenseExecutionPrivateFile(
        submission.projectId,
        submission.expenseRequestId,
        submission.file,
        submission.fileName,
        submission.idempotencyKey
      );
    state.uploadPromise = upload;
    try {
      const uploaded = await upload;
      assertProjectExpenseExecutionCurrent(submission);
      if (uploaded.id !== submission.idempotencyKey) {
        throw new Error(
          "项目支出实付凭证上传幂等响应不一致，请刷新后重试"
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
  assertProjectExpenseExecutionCurrent(submission);

  let response: unknown;
  try {
    response = await recordProjectExpenseExecution(
      submission.projectId,
      submission.expenseRequestId,
      {
        amountCents: submission.amountCents,
        paidAt: submission.paidAt,
        voucherFileId: fileId,
        confirmationPassword: submission.confirmationPassword,
        expectedExpenseUpdatedAt:
          submission.expectedExpenseUpdatedAt,
        idempotencyKey: submission.idempotencyKey
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("当前密码不正确")
    ) {
      state.confirmationPasswordRejected = true;
    }
    throw error;
  }
  assertProjectExpenseExecutionCurrent(submission);
  return response;
}

async function verifyProjectExpenseExecutionPreflight(
  submission: ProjectExpenseExecutionRecordSubmission,
  state: ProjectExpenseExecutionRecordAttemptState
) {
  if (state.preflightVerified) return;
  const preflight =
    state.preflightPromise ??
    fetchProjectExpenseApprovalDetail(
      submission.projectId,
      submission.expenseRequestId
    );
  state.preflightPromise = preflight;
  let detail: ProjectExpenseApprovalLifecycleDetailReadModel;
  try {
    detail = await preflight;
  } catch (error) {
    if (state.preflightPromise === preflight) {
      state.preflightPromise = null;
    }
    throw error;
  }
  assertProjectExpenseExecutionCurrent(submission);
  const enabledActions = detail.availableActions.filter(
    (action) =>
      action.key === "record_execution" && action.enabled
  );
  if (
    detail.projectId !== submission.projectId ||
    detail.id !== submission.expenseRequestId ||
    enabledActions.length !== 1 ||
    detail.lifecycleUpdatedAt !==
      submission.expectedExpenseUpdatedAt ||
    detail.executionContext?.expectedExpenseUpdatedAt !==
      submission.expectedExpenseUpdatedAt
  ) {
    state.preflightPromise = null;
    throw new Error(
      "项目支出执行资格或版本已变化，请刷新详情后重试"
    );
  }
  state.preflightVerified = true;
}

function assertProjectExpenseExecutionCurrent(
  submission: ProjectExpenseExecutionRecordSubmission
) {
  if (!submission.isCurrent()) {
    throw new Error(
      "项目支出实付上下文已失效，请重新读取当前单据"
    );
  }
}

function requiredProjectExpenseExecutionText(
  value: string,
  label: string,
  trim = true
) {
  const normalized = trim ? value.trim() : value;
  if (!normalized.trim()) throw new Error(`请填写${label}`);
  return normalized;
}

export type ProjectExpenseFinanceFailureDisposition =
  | "same_fact"
  | "password_only"
  | "restart";

export function projectExpenseFinanceFailureDisposition(
  error: unknown
): ProjectExpenseFinanceFailureDisposition {
  if (
    error instanceof Error &&
    error.message.includes("当前密码不正确")
  ) {
    return "password_only";
  }
  if (
    error instanceof CoreFlowApiError &&
    error.status >= 500
  ) {
    return "same_fact";
  }
  if (
    error instanceof Error &&
    /网络连接失败|网络请求失败|Failed to fetch|fetch failed|NetworkError|Load failed|ECONNREFUSED/iu.test(
      error.message
    )
  ) {
    return "same_fact";
  }
  return "restart";
}

export function createProjectExpenseFinanceRecordAttemptState(): ProjectExpenseFinanceRecordAttemptState {
  return {
    submission: null,
    confirmationPasswordRejected: false,
    preflightVerified: false,
    preflightPromise: null,
    requestPromise: null
  };
}

export function recordProjectExpenseFinanceWithPreflight<TContext>(
  projectId: string,
  expenseRequestId: string,
  input: RecordProjectExpenseFinanceWithPreflightInput<TContext>,
  state: ProjectExpenseFinanceRecordAttemptState
) {
  if (state.requestPromise) return state.requestPromise;
  let submission: ProjectExpenseFinanceRecordSubmission;
  try {
    const existingSubmission = state.submission;
    submission =
      existingSubmission && state.confirmationPasswordRejected
        ? Object.freeze({
            ...existingSubmission,
            confirmationPassword:
              requiredProjectExpenseFinanceText(
                input.confirmationPassword,
                "当前密码",
                false
              )
          })
        : existingSubmission ??
          normalizeProjectExpenseFinanceRecord(
            projectId,
            expenseRequestId,
            input
          );
    if (
      submission.projectId !== projectId.trim() ||
      submission.expenseRequestId !==
        expenseRequestId.trim()
    ) {
      throw new Error(
        "项目支出财务入账重试单据已变化，请重新打开确认窗口"
      );
    }
    state.submission = submission;
    state.confirmationPasswordRejected = false;
  } catch (error) {
    return Promise.reject(error);
  }

  const request = executeProjectExpenseFinanceRecord(
    submission,
    state
  );
  state.requestPromise = request;
  void request.catch((error) => {
    const disposition =
      projectExpenseFinanceFailureDisposition(error);
    if (disposition === "password_only") {
      state.confirmationPasswordRejected = true;
    } else if (disposition === "restart") {
      state.submission = null;
      state.confirmationPasswordRejected = false;
      state.preflightVerified = false;
      state.preflightPromise = null;
    }
    if (state.requestPromise === request) {
      state.requestPromise = null;
    }
  });
  return request;
}

function normalizeProjectExpenseFinanceRecord<TContext>(
  projectId: string,
  expenseRequestId: string,
  input: RecordProjectExpenseFinanceWithPreflightInput<TContext>
): ProjectExpenseFinanceRecordSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error(
      "项目支出财务入账上下文已失效，请重新读取当前单据"
    );
  }
  const idempotencyKey =
    requiredProjectExpenseFinanceText(
      input.idempotencyKey,
      "项目支出财务入账幂等键"
    ).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      idempotencyKey
    )
  ) {
    throw new Error(
      "项目支出财务入账幂等键必须为 UUIDv4"
    );
  }
  const amountCents = requiredProjectExpenseFinanceText(
    input.amountCents,
    "财务入账金额"
  );
  if (!/^[1-9]\d*$/u.test(amountCents)) {
    throw new Error("财务入账金额必须为正整数分");
  }
  const occurredAt = requiredProjectExpenseFinanceText(
    input.occurredAt,
    "财务入账时间"
  );
  if (Number.isNaN(new Date(occurredAt).getTime())) {
    throw new Error("财务入账时间格式不正确");
  }
  const expectedExpenseUpdatedAt =
    requiredProjectExpenseFinanceText(
      input.expectedExpenseUpdatedAt,
      "项目支出版本"
    );
  if (
    Number.isNaN(
      new Date(expectedExpenseUpdatedAt).getTime()
    )
  ) {
    throw new Error("项目支出版本格式不正确");
  }
  return Object.freeze({
    projectId: requiredProjectExpenseFinanceText(
      projectId,
      "项目编号"
    ),
    expenseRequestId:
      requiredProjectExpenseFinanceText(
        expenseRequestId,
        "项目支出编号"
      ),
    amountCents,
    occurredAt,
    confirmationPassword:
      requiredProjectExpenseFinanceText(
        input.confirmationPassword,
        "当前密码",
        false
      ),
    expectedExpenseUpdatedAt,
    idempotencyKey,
    isCurrent: () => input.isCurrent(input.context)
  });
}

async function executeProjectExpenseFinanceRecord(
  submission: ProjectExpenseFinanceRecordSubmission,
  state: ProjectExpenseFinanceRecordAttemptState
): Promise<ProjectExpenseFinanceRecordReadModel> {
  assertProjectExpenseFinanceCurrent(submission);
  await verifyProjectExpenseFinancePreflight(
    submission,
    state
  );
  assertProjectExpenseFinanceCurrent(submission);
  const response = await recordProjectExpenseFinance(
    submission.projectId,
    submission.expenseRequestId,
    {
      amountCents: submission.amountCents,
      occurredAt: submission.occurredAt,
      confirmationPassword:
        submission.confirmationPassword,
      expectedExpenseUpdatedAt:
        submission.expectedExpenseUpdatedAt,
      idempotencyKey: submission.idempotencyKey
    }
  );
  assertProjectExpenseFinanceCurrent(submission);
  assertProjectExpenseFinanceRecordResponse(
    response,
    submission
  );
  return response;
}

function assertProjectExpenseFinanceRecordResponse(
  response: ProjectExpenseFinanceRecordReadModel,
  submission: ProjectExpenseFinanceRecordSubmission
) {
  if (
    !response ||
    typeof response.id !== "string" ||
    !response.id.trim() ||
    response.idempotencyKey !== submission.idempotencyKey ||
    response.projectId !== submission.projectId ||
    response.projectExpenseRequestId !==
      submission.expenseRequestId ||
    response.paymentRequestId !== null ||
    response.settlementId !== null ||
    response.direction !== "outflow" ||
    response.amountCents !== submission.amountCents ||
    typeof response.occurredAt !== "string" ||
    Number.isNaN(new Date(response.occurredAt).getTime()) ||
    new Date(response.occurredAt).getTime() !==
      new Date(submission.occurredAt).getTime() ||
    typeof response.createdByUserId !== "string" ||
    !response.createdByUserId.trim()
  ) {
    throw new Error(
      "项目支出财务入账响应与本次持久事实不一致，请刷新后核对"
    );
  }
}

export function projectExpenseFinanceCompletionIsAuthoritative(
  detail: ProjectExpenseApprovalLifecycleDetailReadModel,
  baseline: ProjectExpenseFinanceCompletionBaseline
) {
  const baselinePaid = projectExpenseFinanceCents(
    baseline.expectedPaidAmountCents
  );
  const baselineRecorded = projectExpenseFinanceCents(
    baseline.expectedFinanceRecordedAmountCents
  );
  const baselineRemaining = projectExpenseFinanceCents(
    baseline.expectedFinanceRemainingAmountCents
  );
  const submittedAmount = projectExpenseFinanceCents(
    baseline.amountCents
  );
  const latestPaid = projectExpenseFinanceCents(
    detail.paidAmountCents
  );
  const latestRecorded = projectExpenseFinanceCents(
    detail.financeRecordedAmountCents
  );
  const latestRemaining = projectExpenseFinanceCents(
    detail.financeRemainingAmountCents
  );
  if (
    baselinePaid === null ||
    baselineRecorded === null ||
    baselineRemaining === null ||
    submittedAmount === null ||
    latestPaid === null ||
    latestRecorded === null ||
    latestRemaining === null ||
    submittedAmount <= 0n
  ) {
    return false;
  }
  const enabledActions = detail.availableActions.filter(
    (action) =>
      action.key === "record_finance" && action.enabled
  );
  const contextMatches =
    enabledActions.length === 1
      ? detail.financeContext?.expectedExpenseUpdatedAt ===
        detail.lifecycleUpdatedAt
      : enabledActions.length === 0 &&
        detail.financeContext === null;
  return (
    detail.projectId === baseline.projectId &&
    detail.id === baseline.expenseRequestId &&
    typeof detail.lifecycleUpdatedAt === "string" &&
    Boolean(detail.lifecycleUpdatedAt) &&
    detail.lifecycleUpdatedAt !==
      baseline.expectedExpenseUpdatedAt &&
    baselineRemaining ===
      baselinePaid - baselineRecorded &&
    latestPaid >= baselinePaid &&
    latestRecorded >=
      baselineRecorded + submittedAmount &&
    latestRecorded <= latestPaid &&
    latestRemaining === latestPaid - latestRecorded &&
    enabledActions.length <= 1 &&
    contextMatches
  );
}

function projectExpenseFinanceCents(
  value: string
): bigint | null {
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    return null;
  }
  return BigInt(value);
}

async function verifyProjectExpenseFinancePreflight(
  submission: ProjectExpenseFinanceRecordSubmission,
  state: ProjectExpenseFinanceRecordAttemptState
) {
  if (state.preflightVerified) return;
  const preflight =
    state.preflightPromise ??
    fetchProjectExpenseApprovalDetail(
      submission.projectId,
      submission.expenseRequestId
    );
  state.preflightPromise = preflight;
  let detail: ProjectExpenseApprovalLifecycleDetailReadModel;
  try {
    detail = await preflight;
  } catch (error) {
    if (state.preflightPromise === preflight) {
      state.preflightPromise = null;
    }
    throw error;
  }
  assertProjectExpenseFinanceCurrent(submission);
  const enabledActions = detail.availableActions.filter(
    (action) =>
      action.key === "record_finance" && action.enabled
  );
  if (
    detail.projectId !== submission.projectId ||
    detail.id !== submission.expenseRequestId ||
    enabledActions.length !== 1 ||
    detail.lifecycleUpdatedAt !==
      submission.expectedExpenseUpdatedAt ||
    detail.financeContext?.expectedExpenseUpdatedAt !==
      submission.expectedExpenseUpdatedAt
  ) {
    state.preflightPromise = null;
    throw new Error(
      "项目支出财务入账资格或版本已变化，请刷新详情后重试"
    );
  }
  state.preflightVerified = true;
}

function assertProjectExpenseFinanceCurrent(
  submission: ProjectExpenseFinanceRecordSubmission
) {
  if (!submission.isCurrent()) {
    throw new Error(
      "项目支出财务入账上下文已失效，请重新读取当前单据"
    );
  }
}

function requiredProjectExpenseFinanceText(
  value: string,
  label: string,
  trim = true
) {
  const normalized = trim ? value.trim() : value;
  if (!normalized.trim()) throw new Error(`请填写${label}`);
  return normalized;
}

export type ProjectExpenseReceiptFailureDisposition =
  | "same_fact"
  | "password_only"
  | "restart";

export function projectExpenseReceiptFailureDisposition(
  error: unknown
): ProjectExpenseReceiptFailureDisposition {
  if (
    error instanceof Error &&
    error.message.includes("当前密码不正确")
  ) {
    return "password_only";
  }
  if (
    error instanceof CoreFlowApiError &&
    error.status >= 500
  ) {
    return "same_fact";
  }
  if (
    error instanceof Error &&
    /网络连接失败|网络请求失败|Failed to fetch|fetch failed|NetworkError|Load failed|ECONNREFUSED/iu.test(
      error.message
    )
  ) {
    return "same_fact";
  }
  return "restart";
}

export function createProjectExpenseReceiptConfirmationAttemptState(): ProjectExpenseReceiptConfirmationAttemptState {
  return {
    submission: null,
    confirmationPasswordRejected: false,
    preflightVerified: false,
    preflightPromise: null,
    requestPromise: null
  };
}

export function confirmProjectExpenseReceiptWithPreflight<TContext>(
  projectId: string,
  expenseRequestId: string,
  input: ConfirmProjectExpenseReceiptWithPreflightInput<TContext>,
  state: ProjectExpenseReceiptConfirmationAttemptState
) {
  if (state.requestPromise) return state.requestPromise;
  let submission: ProjectExpenseReceiptConfirmationSubmission;
  try {
    const existingSubmission = state.submission;
    submission =
      existingSubmission && state.confirmationPasswordRejected
        ? Object.freeze({
            ...existingSubmission,
            confirmationPassword:
              requiredProjectExpenseReceiptText(
                input.confirmationPassword,
                "当前密码",
                false
              )
          })
        : existingSubmission ??
          normalizeProjectExpenseReceiptConfirmation(
            projectId,
            expenseRequestId,
            input
          );
    if (
      submission.projectId !== projectId.trim() ||
      submission.expenseRequestId !==
        expenseRequestId.trim()
    ) {
      throw new Error(
        "项目支出收货确认重试单据已变化，请重新打开确认窗口"
      );
    }
    state.submission = submission;
    state.confirmationPasswordRejected = false;
  } catch (error) {
    return Promise.reject(error);
  }

  const request = executeProjectExpenseReceiptConfirmation(
    submission,
    state
  );
  state.requestPromise = request;
  void request.catch((error) => {
    const disposition =
      projectExpenseReceiptFailureDisposition(error);
    if (disposition === "password_only") {
      state.confirmationPasswordRejected = true;
    } else if (disposition === "restart") {
      state.submission = null;
      state.confirmationPasswordRejected = false;
      state.preflightVerified = false;
      state.preflightPromise = null;
    }
    if (state.requestPromise === request) {
      state.requestPromise = null;
    }
  });
  return request;
}

function normalizeProjectExpenseReceiptConfirmation<TContext>(
  projectId: string,
  expenseRequestId: string,
  input: ConfirmProjectExpenseReceiptWithPreflightInput<TContext>
): ProjectExpenseReceiptConfirmationSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error(
      "项目支出收货确认上下文已失效，请重新读取当前单据"
    );
  }
  const idempotencyKey =
    requiredProjectExpenseReceiptText(
      input.idempotencyKey,
      "项目支出收货确认幂等键"
    ).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      idempotencyKey
    )
  ) {
    throw new Error(
      "项目支出收货确认幂等键必须为 UUIDv4"
    );
  }
  const expectedExpenseUpdatedAt =
    requiredProjectExpenseReceiptText(
      input.expectedExpenseUpdatedAt,
      "项目支出版本"
    );
  if (
    Number.isNaN(
      new Date(expectedExpenseUpdatedAt).getTime()
    )
  ) {
    throw new Error("项目支出版本格式不正确");
  }
  const normalizedNote = input.note?.trim();
  return Object.freeze({
    projectId: requiredProjectExpenseReceiptText(
      projectId,
      "项目编号"
    ),
    expenseRequestId:
      requiredProjectExpenseReceiptText(
        expenseRequestId,
        "项目支出编号"
      ),
    confirmationPassword:
      requiredProjectExpenseReceiptText(
        input.confirmationPassword,
        "当前密码",
        false
      ),
    ...(normalizedNote ? { note: normalizedNote } : {}),
    expectedExpenseUpdatedAt,
    idempotencyKey,
    isCurrent: () => input.isCurrent(input.context)
  });
}

async function executeProjectExpenseReceiptConfirmation(
  submission: ProjectExpenseReceiptConfirmationSubmission,
  state: ProjectExpenseReceiptConfirmationAttemptState
): Promise<ProjectExpenseReceiptConfirmationReadModel> {
  assertProjectExpenseReceiptCurrent(submission);
  await verifyProjectExpenseReceiptPreflight(
    submission,
    state
  );
  assertProjectExpenseReceiptCurrent(submission);
  const response = await confirmProjectExpenseReceipt(
    submission.projectId,
    submission.expenseRequestId,
    {
      confirmationPassword:
        submission.confirmationPassword,
      ...(submission.note
        ? { note: submission.note }
        : {}),
      expectedExpenseUpdatedAt:
        submission.expectedExpenseUpdatedAt,
      idempotencyKey: submission.idempotencyKey
    }
  );
  assertProjectExpenseReceiptCurrent(submission);
  assertProjectExpenseReceiptConfirmationResponse(
    response,
    submission
  );
  return response;
}

function assertProjectExpenseReceiptConfirmationResponse(
  response: ProjectExpenseReceiptConfirmationReadModel,
  submission: ProjectExpenseReceiptConfirmationSubmission
) {
  const confirmedAt = new Date(response?.confirmedAt).getTime();
  const updatedAt = new Date(response?.updatedAt).getTime();
  const expectedUpdatedAt = new Date(
    submission.expectedExpenseUpdatedAt
  ).getTime();
  if (
    !response ||
    response.projectId !== submission.projectId ||
    response.expenseRequestId !==
      submission.expenseRequestId ||
    response.idempotencyKey !== submission.idempotencyKey ||
    typeof response.confirmedByUserId !== "string" ||
    !response.confirmedByUserId.trim() ||
    Number.isNaN(confirmedAt) ||
    Number.isNaN(updatedAt) ||
    updatedAt <= expectedUpdatedAt ||
    confirmedAt > updatedAt ||
    response.note !== (submission.note ?? null)
  ) {
    throw new Error(
      "项目支出收货确认响应与本次持久事实不一致，请刷新后核对"
    );
  }
}

export function projectExpenseReceiptCompletionIsAuthoritative(
  detail: ProjectExpenseApprovalLifecycleDetailReadModel,
  baseline: ProjectExpenseReceiptCompletionBaseline,
  response: ProjectExpenseReceiptConfirmationReadModel
) {
  const enabledActions = detail.availableActions.filter(
    (action) =>
      action.key === "confirm_receipt" && action.enabled
  );
  const lifecycleUpdatedAt = new Date(
    detail.lifecycleUpdatedAt ?? ""
  ).getTime();
  const responseUpdatedAt = new Date(
    response.updatedAt
  ).getTime();
  return (
    detail.projectId === baseline.projectId &&
    detail.id === baseline.expenseRequestId &&
    response.projectId === baseline.projectId &&
    response.expenseRequestId === baseline.expenseRequestId &&
    response.idempotencyKey === baseline.idempotencyKey &&
    typeof detail.lifecycleUpdatedAt === "string" &&
    !Number.isNaN(lifecycleUpdatedAt) &&
    !Number.isNaN(responseUpdatedAt) &&
    lifecycleUpdatedAt >= responseUpdatedAt &&
    detail.lifecycleUpdatedAt !==
      baseline.expectedExpenseUpdatedAt &&
    typeof detail.receiptConfirmedAt === "string" &&
    detail.receiptConfirmedAt === response.confirmedAt &&
    detail.receiptConfirmedByUserId ===
      response.confirmedByUserId &&
    detail.receiptConfirmationNote === response.note &&
    detail.receiptConfirmationIdempotencyKey ===
      baseline.idempotencyKey &&
    enabledActions.length === 0 &&
    detail.receiptContext === null
  );
}

async function verifyProjectExpenseReceiptPreflight(
  submission: ProjectExpenseReceiptConfirmationSubmission,
  state: ProjectExpenseReceiptConfirmationAttemptState
) {
  if (state.preflightVerified) return;
  const preflight =
    state.preflightPromise ??
    fetchProjectExpenseApprovalDetail(
      submission.projectId,
      submission.expenseRequestId
    );
  state.preflightPromise = preflight;
  let detail: ProjectExpenseApprovalLifecycleDetailReadModel;
  try {
    detail = await preflight;
  } catch (error) {
    if (state.preflightPromise === preflight) {
      state.preflightPromise = null;
    }
    throw error;
  }
  assertProjectExpenseReceiptCurrent(submission);
  const enabledActions = detail.availableActions.filter(
    (action) =>
      action.key === "confirm_receipt" && action.enabled
  );
  if (
    detail.projectId !== submission.projectId ||
    detail.id !== submission.expenseRequestId ||
    enabledActions.length !== 1 ||
    detail.lifecycleUpdatedAt !==
      submission.expectedExpenseUpdatedAt ||
    detail.receiptContext?.expectedExpenseUpdatedAt !==
      submission.expectedExpenseUpdatedAt ||
    detail.receiptConfirmedAt !== null ||
    detail.receiptConfirmationIdempotencyKey !== null
  ) {
    state.preflightPromise = null;
    throw new Error(
      "项目支出收货确认资格或版本已变化，请刷新详情后重试"
    );
  }
  state.preflightVerified = true;
}

function assertProjectExpenseReceiptCurrent(
  submission: ProjectExpenseReceiptConfirmationSubmission
) {
  if (!submission.isCurrent()) {
    throw new Error(
      "项目支出收货确认上下文已失效，请重新读取当前单据"
    );
  }
}

function requiredProjectExpenseReceiptText(
  value: string,
  label: string,
  trim = true
) {
  const normalized = trim ? value.trim() : value;
  if (!normalized.trim()) throw new Error(`请填写${label}`);
  return normalized;
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
      uploadProjectAffiliateCompanyContractPrivateFile(
        submission.projectId,
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

export function getPrivateFileDownloadTicketCapability(fileId: string) {
  return readJson<{
    availableActions: Array<"create_private_file_download_ticket">;
    action: {
      key: "create_private_file_download_ticket";
      enabled: boolean;
    };
  }>(
    `/files/${encodeURIComponent(fileId)}/download-ticket-capability`
  );
}

export function createPrivateFileDownloadTicket(
  fileId: string,
  body: CreatePrivateFileDownloadTicketPayload
) {
  return postJson<PrivateFileDownloadTicketReadModel>(`/files/${fileId}/download-ticket`, body);
}

export function listContractTakeovers(projectId: string) {
  return readJson<ContractTakeoverReadModel[]>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers`
  );
}

export type ContractTakeoverProjectAction =
  | "create_takeover"
  | "precheck_import"
  | "create_import_drafts"
  | "preview_excel_import"
  | "apply_excel_import"
  | "preview_batch_abandonment"
  | "apply_batch_abandonment"
  | "review_import_batch"
  | "upload_takeover_file"
  | "update_takeover"
  | "abandon_takeover"
  | "submit_review"
  | "confirm_takeover"
  | "return_for_supplement"
  | "confirm_change_baseline"
  | "attach_contract_evidence"
  | "attach_payment_voucher"
  | "save_contract_side"
  | "save_finance_side"
  | "confirm_contract_side"
  | "confirm_finance_side"
  | "withdraw_contract_side_confirmation"
  | "withdraw_finance_side_confirmation"
  | "submit_correction"
  | "review_correction"
  | "submit_company_entity_correction"
  | "review_company_entity_correction"
  | "create_tax_fact_revision"
  | "update_tax_fact_revision"
  | "submit_tax_fact_finance_review"
  | "review_tax_fact_by_finance"
  | "confirm_tax_fact_by_contract"
  | "abandon_tax_fact_revision";

export interface ContractTakeoverProjectCapabilityReadModel {
  projectId: string;
  availableActions: ContractTakeoverProjectAction[];
}

export function fetchContractTakeoverProjectCapability(projectId: string) {
  return readJson<ContractTakeoverProjectCapabilityReadModel>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/capability`
  );
}

export function uploadContractTakeoverPrivateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  return postForm<PrivateFileReadModel>(
    `/projects/${encodeURIComponent(projectId)}/contract-takeovers/files`,
    form
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

export async function prepareContractApprovalReviewAction(
  input: PrepareContractApprovalReviewActionInput
): Promise<PrepareContractApprovalReviewActionResult> {
  const context = normalizeContractApprovalReviewAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchContractDetail(
    context.routeContractId
  ) as ContractApprovalReviewPreflightReadModel;
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertContractApprovalReviewPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeContractApprovalReviewAction(
  input: ExecuteContractApprovalReviewActionInput
): Promise<ExecuteContractApprovalReviewActionResult> {
  const capturedContext = input.capture(input.decision);
  if (!capturedContext) return { status: "not_started" };
  let activeContext = capturedContext;

  try {
    const frozenCapturedContext = normalizeContractApprovalReviewAction(
      capturedContext
    );
    activeContext = frozenCapturedContext;
    const prepared = await input.preflight(frozenCapturedContext);
    activeContext = prepared.context;
    if (
      prepared.status !== "ready" ||
      !sameContractApprovalReviewContext(
        frozenCapturedContext,
        prepared.context
      ) ||
      !input.current(frozenCapturedContext, prepared)
    ) {
      await input.stale(frozenCapturedContext);
      return { status: "stale", context: frozenCapturedContext };
    }

    const payload = contractApprovalReviewActionPayload(
      activeContext,
      input.decision
    );
    let response: unknown;
    try {
      response = await postJson<unknown>(
        `/contracts/${encodeURIComponent(activeContext.contractVersionId)}/approval`,
        payload
      );
    } catch (error) {
      if (error instanceof CoreFlowApiError && error.status < 500) {
        throw error;
      }
      throw new ContractApprovalReviewResultUnknownError(error);
    }

    if (!input.current(frozenCapturedContext, prepared)) {
      await input.stale(activeContext);
      return { status: "stale", context: activeContext };
    }
    await input.complete(activeContext, response);
    return { status: "completed", context: activeContext, response };
  } catch (error) {
    await input.fail(activeContext, error);
    return { status: "failed", context: activeContext, error };
  } finally {
    input.finish(activeContext);
  }
}

function contractApprovalReviewActionPayload(
  context: ContractApprovalReviewActionContext,
  decision: ContractApprovalReviewActionDecision
): ReviewContractApprovalPayload {
  if (
    context.decision !== decision ||
    (decision === "reject" && !context.comment) ||
    (context.requiresSelfReviewConfirmation &&
      (!context.selfReviewReason ||
        !context.confirmationPassword?.trim())) ||
    (decision === "approve" &&
      context.ownerContractRisk?.requiresExplicitConfirmation === true &&
      !context.ownerContractRiskConfirmed)
  ) {
    throw new Error(
      "合同审批上下文无效，请重新读取当前合同后再操作"
    );
  }

  return {
    decision,
    ...(context.comment ? { comment: context.comment } : {}),
    ...(context.requiresSelfReviewConfirmation
      ? {
          selfReviewReason: context.selfReviewReason,
          confirmationPassword: context.confirmationPassword
        }
      : {}),
    ...(decision === "approve" &&
    context.ownerContractRisk?.requiresExplicitConfirmation
      ? {
          ownerContractRiskConfirmed: true,
          expectedOwnerContractRisk: context.ownerContractRisk
        }
      : {}),
    expectedContractUpdatedAt: context.expectedContractUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
}

function normalizeContractApprovalReviewAction(
  input: ContractApprovalReviewActionContext
): ContractApprovalReviewActionContext {
  const ownerScope = input.ownerScope.trim();
  const routeContractId = input.routeContractId.trim();
  const contractId = input.contractId.trim();
  const contractVersionId = input.contractVersionId.trim();
  const expectedContractUpdatedAt =
    input.expectedContractUpdatedAt.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const expectedApprovalUpdatedAt =
    input.expectedApprovalUpdatedAt.trim();
  const comment = input.comment?.trim() || undefined;
  const selfReviewReason = input.requiresSelfReviewConfirmation
    ? input.selfReviewReason?.trim() || undefined
    : undefined;
  const confirmationPassword = input.requiresSelfReviewConfirmation
    ? input.confirmationPassword
    : undefined;
  const ownerContractRisk = normalizeContractApprovalOwnerRisk(
    input.ownerContractRisk
  );
  if (
    !ownerScope ||
    !routeContractId ||
    !contractId ||
    !contractVersionId ||
    !expectedContractUpdatedAt ||
    !expectedApprovalInstanceId ||
    !expectedApprovalUpdatedAt ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0 ||
    (input.decision !== "approve" && input.decision !== "reject") ||
    typeof input.requiresSelfReviewConfirmation !== "boolean" ||
    typeof input.ownerContractRiskConfirmed !== "boolean" ||
    (input.decision === "reject" && !comment) ||
    (input.requiresSelfReviewConfirmation &&
      (!selfReviewReason || !confirmationPassword?.trim())) ||
    (input.decision === "approve" &&
      ownerContractRisk?.requiresExplicitConfirmation === true &&
      !input.ownerContractRiskConfirmed)
  ) {
    throw new Error(
      "合同审批上下文无效，请重新读取当前合同后再操作"
    );
  }

  return Object.freeze({
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    routeContractId,
    contractId,
    contractVersionId,
    expectedContractUpdatedAt,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt,
    decision: input.decision,
    requiresSelfReviewConfirmation:
      input.requiresSelfReviewConfirmation,
    ownerContractRisk,
    ownerContractRiskConfirmed: input.ownerContractRiskConfirmed,
    ...(comment ? { comment } : {}),
    ...(selfReviewReason ? { selfReviewReason } : {}),
    ...(confirmationPassword ? { confirmationPassword } : {})
  });
}

function sameContractApprovalReviewContext(
  expected: ContractApprovalReviewActionContext,
  actual: ContractApprovalReviewActionContext
) {
  return (
    expected.ownerScope === actual.ownerScope &&
    expected.routeGeneration === actual.routeGeneration &&
    expected.detailEpoch === actual.detailEpoch &&
    expected.dialogGeneration === actual.dialogGeneration &&
    expected.operationId === actual.operationId &&
    expected.routeContractId === actual.routeContractId &&
    expected.contractId === actual.contractId &&
    expected.contractVersionId === actual.contractVersionId &&
    expected.expectedContractUpdatedAt ===
      actual.expectedContractUpdatedAt &&
    expected.expectedApprovalInstanceId ===
      actual.expectedApprovalInstanceId &&
    expected.expectedNodeIndex === actual.expectedNodeIndex &&
    expected.expectedApprovalUpdatedAt ===
      actual.expectedApprovalUpdatedAt &&
    expected.decision === actual.decision &&
    expected.comment === actual.comment &&
    expected.requiresSelfReviewConfirmation ===
      actual.requiresSelfReviewConfirmation &&
    expected.selfReviewReason === actual.selfReviewReason &&
    expected.confirmationPassword === actual.confirmationPassword &&
    expected.ownerContractRiskConfirmed ===
      actual.ownerContractRiskConfirmed &&
    sameContractApprovalOwnerRisk(
      expected.ownerContractRisk,
      actual.ownerContractRisk
    )
  );
}

function normalizeContractApprovalOwnerRisk(
  input: ContractApprovalOwnerRiskSnapshot | null
): ContractApprovalOwnerRiskSnapshot | null {
  if (input === null) return null;
  if (
    !["clear", "missing_owner_contract", "exceeds_owner_contract"].includes(
      input.status
    ) ||
    typeof input.ownerContractAmountCents !== "string" ||
    typeof input.downstreamContractAmountCents !== "string" ||
    typeof input.excessAmountCents !== "string" ||
    typeof input.message !== "string" ||
    typeof input.requiresExplicitConfirmation !== "boolean"
  ) {
    throw new Error(
      "合同审批上下文无效，请重新读取当前合同后再操作"
    );
  }
  return Object.freeze({
    status: input.status,
    ownerContractAmountCents: input.ownerContractAmountCents,
    downstreamContractAmountCents:
      input.downstreamContractAmountCents,
    excessAmountCents: input.excessAmountCents,
    message: input.message,
    requiresExplicitConfirmation: input.requiresExplicitConfirmation
  });
}

function assertContractApprovalReviewPreflight(
  context: ContractApprovalReviewActionContext,
  preflight: ContractApprovalReviewPreflightReadModel
) {
  const enabledReviewActions = preflight.availableActions.filter(
    (action) => action.key === "review_approval" && action.enabled
  );
  const coordinates = preflight.reviewApprovalContext;
  if (
    preflight.id !== context.contractId ||
    preflight.contractVersionId !== context.contractVersionId ||
    preflight.lifecycleUpdatedAt !== context.expectedContractUpdatedAt ||
    enabledReviewActions.length !== 1 ||
    (enabledReviewActions[0]?.requiresSelfReviewConfirmation === true) !==
      context.requiresSelfReviewConfirmation ||
    coordinates?.expectedContractUpdatedAt !==
      context.expectedContractUpdatedAt ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex ||
    coordinates.expectedApprovalUpdatedAt !==
      context.expectedApprovalUpdatedAt ||
    !sameContractApprovalOwnerRisk(
      context.ownerContractRisk,
      preflight.ownerContractRisk ?? null
    )
  ) {
    throw new Error(
      "合同审批资格、风险或审批坐标已变化，请重新读取当前合同"
    );
  }
}

function sameContractApprovalOwnerRisk(
  expected: ContractApprovalOwnerRiskSnapshot | null,
  actual: ContractDetailReadModel["ownerContractRisk"] | null
) {
  if (expected === null || actual == null) {
    return expected === null && actual == null;
  }
  return (
    expected.status === actual.status &&
    expected.ownerContractAmountCents === actual.ownerContractAmountCents &&
    expected.downstreamContractAmountCents ===
      actual.downstreamContractAmountCents &&
    expected.excessAmountCents === actual.excessAmountCents &&
    expected.message === actual.message &&
    expected.requiresExplicitConfirmation ===
      actual.requiresExplicitConfirmation
  );
}

export async function prepareContractApprovalWithdrawalAction(
  input: PrepareContractApprovalWithdrawalActionInput
): Promise<PrepareContractApprovalWithdrawalActionResult> {
  const context = normalizeContractApprovalWithdrawalAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchContractDetail(
    context.routeContractId
  ) as ContractApprovalWithdrawalPreflightReadModel;
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertContractApprovalWithdrawalPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeContractApprovalWithdrawalAction(
  input: ExecuteContractApprovalWithdrawalActionInput
): Promise<ExecuteContractApprovalWithdrawalActionResult> {
  const capturedContext = input.capture(input.action);
  if (!capturedContext) return { status: "not_started" };
  let activeContext = capturedContext;

  try {
    const frozenCapturedContext = normalizeContractApprovalWithdrawalAction(
      capturedContext
    );
    activeContext = frozenCapturedContext;
    const prepared = await input.preflight(frozenCapturedContext);
    activeContext = prepared.context;
    if (
      prepared.status !== "ready" ||
      !sameContractApprovalWithdrawalContext(
        frozenCapturedContext,
        prepared.context
      ) ||
      !input.current(frozenCapturedContext, prepared)
    ) {
      await input.stale(frozenCapturedContext);
      return { status: "stale", context: frozenCapturedContext };
    }

    let response: unknown;
    try {
      response = await postJson<unknown>(
        `/contracts/${encodeURIComponent(activeContext.contractVersionId)}/approval-withdrawal`,
        contractApprovalWithdrawalPayload(activeContext)
      );
    } catch (error) {
      if (error instanceof CoreFlowApiError && error.status < 500) {
        throw error;
      }
      throw new ContractApprovalWithdrawalResultUnknownError(error);
    }

    if (!input.current(frozenCapturedContext, prepared)) {
      throw new ContractApprovalWithdrawalResultUnknownError(
        new Error("合同审批撤回请求已发出，但提交后的页面归属已变化")
      );
    }
    await input.complete(activeContext, response);
    return { status: "completed", context: activeContext, response };
  } catch (error) {
    await input.fail(activeContext, error);
    return { status: "failed", context: activeContext, error };
  } finally {
    input.finish(activeContext);
  }
}

function normalizeContractApprovalWithdrawalAction(
  input: ContractApprovalWithdrawalActionContext
): ContractApprovalWithdrawalActionContext {
  const ownerScope = input.ownerScope.trim();
  const routeContractId = input.routeContractId.trim();
  const contractId = input.contractId.trim();
  const contractVersionId = input.contractVersionId.trim();
  const expectedContractUpdatedAt =
    input.expectedContractUpdatedAt.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const expectedApprovalUpdatedAt =
    input.expectedApprovalUpdatedAt.trim();
  if (
    input.action !== "withdraw" ||
    !ownerScope ||
    !routeContractId ||
    !contractId ||
    !contractVersionId ||
    !expectedContractUpdatedAt ||
    !expectedApprovalInstanceId ||
    !expectedApprovalUpdatedAt ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0
  ) {
    throw new Error(
      "合同审批撤回上下文无效，请重新读取当前合同后再操作"
    );
  }

  return Object.freeze({
    action: "withdraw",
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    routeContractId,
    contractId,
    contractVersionId,
    expectedContractUpdatedAt,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt
  });
}

function sameContractApprovalWithdrawalContext(
  expected: ContractApprovalWithdrawalActionContext,
  actual: ContractApprovalWithdrawalActionContext
) {
  return (
    expected.action === actual.action &&
    expected.ownerScope === actual.ownerScope &&
    expected.routeGeneration === actual.routeGeneration &&
    expected.detailEpoch === actual.detailEpoch &&
    expected.dialogGeneration === actual.dialogGeneration &&
    expected.operationId === actual.operationId &&
    expected.routeContractId === actual.routeContractId &&
    expected.contractId === actual.contractId &&
    expected.contractVersionId === actual.contractVersionId &&
    expected.expectedContractUpdatedAt ===
      actual.expectedContractUpdatedAt &&
    expected.expectedApprovalInstanceId ===
      actual.expectedApprovalInstanceId &&
    expected.expectedNodeIndex === actual.expectedNodeIndex &&
    expected.expectedApprovalUpdatedAt ===
      actual.expectedApprovalUpdatedAt
  );
}

function assertContractApprovalWithdrawalPreflight(
  context: ContractApprovalWithdrawalActionContext,
  preflight: ContractApprovalWithdrawalPreflightReadModel
) {
  const enabledWithdrawalActions = preflight.availableActions.filter(
    (action) => action.key === "withdraw_approval" && action.enabled
  );
  const coordinates = preflight.withdrawApprovalContext;
  if (
    preflight.id !== context.contractId ||
    preflight.contractVersionId !== context.contractVersionId ||
    preflight.lifecycleUpdatedAt !== context.expectedContractUpdatedAt ||
    enabledWithdrawalActions.length !== 1 ||
    coordinates?.expectedContractUpdatedAt !==
      context.expectedContractUpdatedAt ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex ||
    coordinates.expectedApprovalUpdatedAt !==
      context.expectedApprovalUpdatedAt
  ) {
    throw new Error(
      "合同审批撤回资格或审批坐标已变化，请重新读取当前合同"
    );
  }
}

function contractApprovalWithdrawalPayload(
  context: ContractApprovalWithdrawalActionContext
): ContractApprovalWithdrawalCoordinates {
  if (context.action !== "withdraw") {
    throw new Error(
      "合同审批撤回上下文无效，请重新读取当前合同后再操作"
    );
  }
  return {
    expectedContractUpdatedAt: context.expectedContractUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
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

export async function prepareSettlementApprovalWithdrawalAction(
  input: PrepareSettlementApprovalWithdrawalActionInput
): Promise<PrepareSettlementApprovalWithdrawalActionResult> {
  const context = normalizeSettlementApprovalWithdrawalAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = normalizeSettlementApprovalWithdrawalPreflight(
    await fetchSettlementDetail(context.routeSettlementId)
  );
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertSettlementApprovalWithdrawalPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeSettlementApprovalWithdrawalAction(
  input: ExecuteSettlementApprovalWithdrawalActionInput
): Promise<ExecuteSettlementApprovalWithdrawalActionResult> {
  const capturedContext = input.capture(input.action);
  if (!capturedContext) return { status: "not_started" };
  let activeContext = capturedContext;

  try {
    const frozenCapturedContext = normalizeSettlementApprovalWithdrawalAction(
      capturedContext
    );
    activeContext = frozenCapturedContext;
    const prepared = await input.preflight(frozenCapturedContext);
    activeContext = prepared.context;
    if (
      prepared.status !== "ready" ||
      !sameSettlementApprovalWithdrawalContext(
        frozenCapturedContext,
        prepared.context
      ) ||
      !input.current(frozenCapturedContext, prepared)
    ) {
      await input.stale(frozenCapturedContext);
      return { status: "stale", context: frozenCapturedContext };
    }

    let response: SettlementApprovalWithdrawalResponse;
    try {
      response = await postSettlementApprovalWithdrawalRequest(activeContext);
    } catch (error) {
      if (error instanceof CoreFlowApiError && error.status < 500) {
        throw error;
      }
      throw new SettlementApprovalWithdrawalResultUnknownError(error);
    }

    try {
      if (!input.current(frozenCapturedContext, prepared)) {
        throw new SettlementApprovalWithdrawalResultUnknownError(
          new Error("结算审批撤回请求已发出，但提交后的页面归属已变化")
        );
      }
      await input.complete(activeContext, response);
    } catch (error) {
      if (error instanceof SettlementApprovalWithdrawalResultUnknownError) {
        throw error;
      }
      throw new SettlementApprovalWithdrawalResultUnknownError(error);
    }
    return { status: "completed", context: activeContext, response };
  } catch (error) {
    await input.fail(activeContext, error);
    return { status: "failed", context: activeContext, error };
  } finally {
    input.finish(activeContext);
  }
}

async function postSettlementApprovalWithdrawalRequest(
  context: SettlementApprovalWithdrawalActionContext
) {
  const response = await postJson<unknown>(
    `/settlements/${encodeURIComponent(context.settlementId)}/approval-withdrawal`,
    settlementApprovalWithdrawalPayload(context)
  );
  return normalizeSettlementApprovalWithdrawalResponse(response, context);
}

function normalizeSettlementApprovalWithdrawalAction(
  input: SettlementApprovalWithdrawalActionContext
): SettlementApprovalWithdrawalActionContext {
  const ownerScope = input.ownerScope.trim();
  const routeSettlementId = input.routeSettlementId.trim();
  const settlementCode = input.settlementCode.trim();
  const settlementId = input.settlementId.trim();
  const expectedSettlementUpdatedAt =
    input.expectedSettlementUpdatedAt.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const expectedApprovalUpdatedAt =
    input.expectedApprovalUpdatedAt.trim();
  if (
    input.action !== "withdraw" ||
    !ownerScope ||
    !routeSettlementId ||
    !settlementCode ||
    !settlementId ||
    !expectedSettlementUpdatedAt ||
    !expectedApprovalInstanceId ||
    !expectedApprovalUpdatedAt ||
    Number.isNaN(new Date(expectedSettlementUpdatedAt).getTime()) ||
    Number.isNaN(new Date(expectedApprovalUpdatedAt).getTime()) ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0
  ) {
    throw new Error(
      "结算审批撤回上下文无效，请重新读取当前结算后再操作"
    );
  }

  return Object.freeze({
    action: "withdraw",
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    routeSettlementId,
    settlementCode,
    settlementId,
    expectedSettlementUpdatedAt,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt
  });
}

function sameSettlementApprovalWithdrawalContext(
  expected: SettlementApprovalWithdrawalActionContext,
  actual: SettlementApprovalWithdrawalActionContext
) {
  return (
    expected.action === actual.action &&
    expected.ownerScope === actual.ownerScope &&
    expected.routeGeneration === actual.routeGeneration &&
    expected.detailEpoch === actual.detailEpoch &&
    expected.dialogGeneration === actual.dialogGeneration &&
    expected.operationId === actual.operationId &&
    expected.routeSettlementId === actual.routeSettlementId &&
    expected.settlementCode === actual.settlementCode &&
    expected.settlementId === actual.settlementId &&
    expected.expectedSettlementUpdatedAt ===
      actual.expectedSettlementUpdatedAt &&
    expected.expectedApprovalInstanceId ===
      actual.expectedApprovalInstanceId &&
    expected.expectedNodeIndex === actual.expectedNodeIndex &&
    expected.expectedApprovalUpdatedAt ===
      actual.expectedApprovalUpdatedAt
  );
}

function normalizeSettlementApprovalWithdrawalPreflight(
  input: unknown
): SettlementApprovalWithdrawalPreflightReadModel {
  if (!isSettlementWithdrawalRecord(input)) {
    throw new Error("结算审批撤回权威详情无效，请重新读取当前结算");
  }
  const { availableActions, withdrawApprovalContext } = input;
  if (
    typeof input.id !== "string" ||
    !input.id.trim() ||
    typeof input.settlementId !== "string" ||
    !input.settlementId.trim() ||
    typeof input.lifecycleUpdatedAt !== "string" ||
    !input.lifecycleUpdatedAt.trim() ||
    Number.isNaN(new Date(input.lifecycleUpdatedAt).getTime()) ||
    !Array.isArray(availableActions) ||
    availableActions.some(
      (action) =>
        !isSettlementWithdrawalRecord(action) ||
        typeof action.key !== "string" ||
        typeof action.enabled !== "boolean"
    ) ||
    (withdrawApprovalContext !== null &&
      (!isSettlementWithdrawalRecord(withdrawApprovalContext) ||
        typeof withdrawApprovalContext.expectedSettlementUpdatedAt !==
          "string" ||
        Number.isNaN(
          new Date(
            withdrawApprovalContext.expectedSettlementUpdatedAt
          ).getTime()
        ) ||
        typeof withdrawApprovalContext.expectedApprovalInstanceId !==
          "string" ||
        typeof withdrawApprovalContext.expectedNodeIndex !== "number" ||
        !Number.isInteger(withdrawApprovalContext.expectedNodeIndex) ||
        withdrawApprovalContext.expectedNodeIndex < 0 ||
        typeof withdrawApprovalContext.expectedApprovalUpdatedAt !==
          "string" ||
        Number.isNaN(
          new Date(
            withdrawApprovalContext.expectedApprovalUpdatedAt
          ).getTime()
        )))
  ) {
    throw new Error("结算审批撤回权威详情无效，请重新读取当前结算");
  }
  return input as unknown as SettlementApprovalWithdrawalPreflightReadModel;
}

function assertSettlementApprovalWithdrawalPreflight(
  context: SettlementApprovalWithdrawalActionContext,
  preflight: SettlementApprovalWithdrawalPreflightReadModel
) {
  const enabledWithdrawalActions = preflight.availableActions.filter(
    (action) => action.key === "withdraw_approval" && action.enabled
  );
  const coordinates = preflight.withdrawApprovalContext;
  if (
    preflight.id !== context.settlementCode ||
    preflight.settlementId !== context.settlementId ||
    preflight.lifecycleUpdatedAt !== context.expectedSettlementUpdatedAt ||
    enabledWithdrawalActions.length !== 1 ||
    coordinates?.expectedSettlementUpdatedAt !==
      context.expectedSettlementUpdatedAt ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex ||
    coordinates.expectedApprovalUpdatedAt !==
      context.expectedApprovalUpdatedAt
  ) {
    throw new Error(
      "结算审批撤回资格或审批坐标已变化，请重新读取当前结算"
    );
  }
}

function settlementApprovalWithdrawalPayload(
  context: SettlementApprovalWithdrawalActionContext
): SettlementApprovalWithdrawalCoordinates {
  if (context.action !== "withdraw") {
    throw new Error(
      "结算审批撤回上下文无效，请重新读取当前结算后再操作"
    );
  }
  return {
    expectedSettlementUpdatedAt: context.expectedSettlementUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
}

function normalizeSettlementApprovalWithdrawalResponse(
  input: unknown,
  context: SettlementApprovalWithdrawalActionContext
): SettlementApprovalWithdrawalResponse {
  if (
    !isSettlementWithdrawalRecord(input) ||
    typeof input.id !== "string" ||
    input.id !== context.settlementId ||
    typeof input.status !== "string" ||
    input.status !== "withdrawn"
  ) {
    throw new Error("结算审批撤回响应无效，请读取权威结算详情核对结果");
  }
  return Object.freeze({ id: input.id, status: input.status });
}

function isSettlementWithdrawalRecord(
  input: unknown
): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
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

export async function preparePaymentApprovalReviewAction(
  input: PreparePaymentApprovalReviewActionInput
): Promise<PreparePaymentApprovalReviewActionResult> {
  const context = normalizePaymentApprovalReviewAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchPaymentDetail(context.paymentId);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertPaymentApprovalReviewPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executePaymentApprovalReviewAction(
  input: ExecutePaymentApprovalReviewActionInput
): Promise<ExecutePaymentApprovalReviewActionResult> {
  const context = input.capture(input.decision);
  if (!context) return { status: "not_started" };

  try {
    const prepared = await input.preflight(context);
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    const response = await postJson<unknown>(
      `/payments/${encodeURIComponent(context.paymentId)}/approval`,
      paymentApprovalReviewActionPayload(context, input.decision)
    );
    await input.complete(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context };
  } finally {
    input.finish(context);
  }
}

function paymentApprovalReviewActionPayload(
  context: PaymentApprovalReviewActionContext,
  decision: PaymentApprovalReviewActionDecision
): ReviewPaymentApprovalPayload {
  if (
    context.decision !== decision ||
    (decision === "reject" && !context.comment) ||
    (context.requiresSelfReviewConfirmation &&
      (!context.selfReviewReason || !context.confirmationPassword?.trim()))
  ) {
    throw new Error("付款审批上下文无效，请重新读取当前付款后再操作");
  }

  return {
    decision,
    ...(decision === "approve" && context.approvedAmountCents
      ? { approvedAmountCents: context.approvedAmountCents }
      : {}),
    ...(context.comment ? { comment: context.comment } : {}),
    ...(context.requiresSelfReviewConfirmation
      ? {
          selfReviewReason: context.selfReviewReason,
          confirmationPassword: context.confirmationPassword
        }
      : {}),
    expectedPaymentUpdatedAt: context.expectedPaymentUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
}

function normalizePaymentApprovalReviewAction(
  input: PreparePaymentApprovalReviewActionInput
): PaymentApprovalReviewActionContext {
  const ownerScope = input.ownerScope.trim();
  const paymentId = input.paymentId.trim();
  const expectedPaymentUpdatedAt = input.expectedPaymentUpdatedAt.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const expectedApprovalUpdatedAt =
    input.expectedApprovalUpdatedAt.trim();
  const approvedAmountCents =
    input.decision === "approve"
      ? input.approvedAmountCents?.trim() || undefined
      : undefined;
  const comment = input.comment?.trim() || undefined;
  const selfReviewReason = input.requiresSelfReviewConfirmation
    ? input.selfReviewReason?.trim() || undefined
    : undefined;
  const confirmationPassword = input.requiresSelfReviewConfirmation
    ? input.confirmationPassword
    : undefined;
  if (
    !ownerScope ||
    !paymentId ||
    !expectedPaymentUpdatedAt ||
    !expectedApprovalInstanceId ||
    !expectedApprovalUpdatedAt ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0 ||
    (input.decision !== "approve" && input.decision !== "reject") ||
    (approvedAmountCents !== undefined &&
      !/^(?:0|[1-9]\d*)$/.test(approvedAmountCents)) ||
    (input.decision === "reject" && !comment) ||
    (input.requiresSelfReviewConfirmation &&
      (!selfReviewReason || !confirmationPassword?.trim()))
  ) {
    throw new Error("付款审批上下文无效，请重新读取当前付款后再操作");
  }

  return Object.freeze({
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    paymentId,
    expectedPaymentUpdatedAt,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt,
    decision: input.decision,
    requiresSelfReviewConfirmation:
      input.requiresSelfReviewConfirmation,
    ...(approvedAmountCents ? { approvedAmountCents } : {}),
    ...(comment ? { comment } : {}),
    ...(selfReviewReason ? { selfReviewReason } : {}),
    ...(confirmationPassword ? { confirmationPassword } : {})
  });
}

function assertPaymentApprovalReviewPreflight(
  context: PaymentApprovalReviewActionContext,
  preflight: PaymentLifecycleDetailReadModel
) {
  const enabledReviewActions = preflight.availableActions.filter(
    (action) => action.key === "review_approval" && action.enabled
  );
  const reviewAction = enabledReviewActions[0];
  const coordinates = preflight.reviewApprovalContext;
  if (
    preflight.id !== context.paymentId ||
    preflight.lifecycleUpdatedAt !== context.expectedPaymentUpdatedAt ||
    enabledReviewActions.length !== 1 ||
    reviewAction?.requiresSelfReviewConfirmation !==
      context.requiresSelfReviewConfirmation ||
    coordinates?.expectedPaymentUpdatedAt !==
      context.expectedPaymentUpdatedAt ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex ||
    coordinates.expectedApprovalUpdatedAt !==
      context.expectedApprovalUpdatedAt
  ) {
    throw new Error(
      "付款审批资格或审批坐标已变化，请重新读取当前付款"
    );
  }
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

export function uploadCanvasSignature(file: Blob) {
  const form = new FormData();
  form.append("file", file, "手写签名.png");
  return postForm<{ signatureFileId: string; signatureVersionId: string }>("/me/signature/canvas", form);
}

export interface CanvasSignatureCapabilitiesReadModel {
  availableActions: Array<
    "upload_canvas_signature" | "create_canvas_signature_handoff"
  >;
}

export function getCanvasSignatureCapabilities() {
  return readJson<CanvasSignatureCapabilitiesReadModel>(
    "/me/signature/canvas-capabilities"
  );
}

export interface CanvasSignatureHandoffReadModel {
  expiresAt: string;
  completedAt: string | null;
  signatureVersionId: string | null;
  availableActions: Array<"complete_canvas_signature_handoff">;
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
  return postJson<unknown>(
    `/payments/${encodeURIComponent(paymentId)}/executions`,
    body
  );
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

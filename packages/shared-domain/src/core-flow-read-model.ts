import type { BusinessAction } from "./permissions";
import type { MoneyCents } from "./money";

export const CORE_FLOW_READ_ENDPOINTS = {
  contractDetail: "/contracts/:contractId",
  settlementDetail: "/settlements/:settlementId",
  paymentDetail: "/payments/:paymentId",
  contractPaymentApplication: "/payments/contract-application"
} as const;

export type CoreFlowTone = "default" | "primary" | "warning" | "danger" | "success";

export interface DetailMetaItem {
  label: string;
  value: string;
  tone?: CoreFlowTone;
}

export interface BusinessChainLink {
  label: string;
  to: string;
}

export interface DetailStep {
  label: string;
  status: string;
  tone: CoreFlowTone;
  owner?: string;
}

export interface ContractPaymentTermStageReadModel {
  id: string;
  version: string;
  paymentTermsVersion: string;
  status: string;
  contractVersion: string;
  basis: string;
  ratio: string;
  accountPeriod: string;
  triggerEvent: string;
  advanceDeductionMode?: string;
  advanceDeductionRatioBps?: number | null;
  advanceDeductionStartRatioBps?: number | null;
}

export interface ContractSettlementPaymentSummaryItem {
  label: string;
  value: string;
  tone?: CoreFlowTone;
}

export interface ContractSettlementLedgerRowReadModel {
  id: string;
  settlementNo: string;
  period: string;
  settlementDate: string;
  settlementMethod: string;
  currentAmount: string;
  cumulativeBeforeAmount: string;
  cumulativeAfterAmount: string;
  approvalStatus: string;
  archiveStatus: string;
}

export interface ContractPaymentLedgerRowReadModel {
  id: string;
  paymentNo: string;
  settlementNo: string;
  requestedAmount: string;
  approvedAmount: string;
  paidAmount: string;
  paymentDate: string;
  approvalStatus: string;
  paymentStatus: string;
  voucherStatus: string;
}

export interface ContractSettlementPaymentReadModel {
  summary: ContractSettlementPaymentSummaryItem[];
  settlementRows: ContractSettlementLedgerRowReadModel[];
  paymentRows: ContractPaymentLedgerRowReadModel[];
  calculationNote: string;
}

export interface ContractArchiveFileReadModel {
  archiveRecordId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  statusLabel: string;
  uploadedByName: string;
  createdAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
  canDownload: boolean;
  disabledReason: string | null;
}

export interface EvidenceFileReadModel {
  recordId: string;
  fileId: string;
  fileName: string;
  purpose: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  statusLabel: string;
  uploadedByName: string;
  uploadedAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
  canDownload: boolean;
  disabledReason: string | null;
}

export interface DetailActionReadModel {
  key: string;
  label: string;
  kind: "primary" | "normal" | "danger";
  enabled: boolean;
  disabledReason: string | null;
  requiredAction?: BusinessAction;
  requiresPassword?: boolean;
  requiresComment?: boolean;
  requiresFile?: boolean;
  requiresSelfReviewConfirmation?: boolean;
}

export interface ApprovalTimelineItemReadModel {
  id: string;
  action: string;
  actionLabel: string;
  actorUserId: string;
  actorName: string;
  comment: string | null;
  nodeName: string | null;
  roleName: string | null;
  selfReview: boolean;
  selfReviewReason: string | null;
  createdAt: string;
}

export interface ProjectExpenseApprovalDetailReadModel {
  id: string;
  projectId: string;
  code: string;
  title: string;
  status: string;
  statusLabel: string;
  expenseTypeLabel: string;
  expenseSubtypeLabel: string;
  paymentSubject: string;
  reason: string;
  requestedAmountCents: MoneyCents;
  approvedAmountCents: MoneyCents | null;
  currentNodeName: string | null;
  canSetApprovedAmount: boolean;
  reviewAction: DetailActionReadModel;
  approvalTimeline: ApprovalTimelineItemReadModel[];
}

export interface ContractDetailReadModel {
  id: string;
  contractVersionId: string;
  title: string;
  meta: DetailMetaItem[];
  baseInfo: DetailMetaItem[];
  effectivenessSteps: DetailStep[];
  paymentTermStages: ContractPaymentTermStageReadModel[];
  settlementBlockMessage: string;
  settlementPayment: ContractSettlementPaymentReadModel;
  archiveFiles: ContractArchiveFileReadModel[];
  approvalTimeline: ApprovalTimelineItemReadModel[];
  availableActions: DetailActionReadModel[];
  primaryAction: string | null;
  disabledReasons: string[];
  chainLinks: BusinessChainLink[];
  changeVersions?: Array<{
    versionNo: number;
    status: string;
    changeType: string;
    changeReason: string | null;
    changeDirection: string | null;
    changeAmountCents: MoneyCents | null;
    amountCents: MoneyCents;
    approvalRoute: string[];
    archiveEffect: {
      status: "pending" | "completed";
      replacesVersionNo: number;
      beforeAmountCents: MoneyCents;
      afterAmountCents: MoneyCents;
      /** 已完成替代不会改写历史业务记录所引用的合同版本。 */
      historyReferencesStable: true;
    } | null;
  }>;
}

export interface SettlementPaymentRuleReadModel {
  id: string;
  stage: string;
  ratio: string;
  accountPeriod: string;
  invoiceRequirement: string;
  triggerCondition: string;
  paymentRequestStatus: string;
}

export interface SettlementPayableCalculationItemReadModel {
  label: string;
  value: string;
  tone?: CoreFlowTone;
}

export interface SettlementPayableCalculationReadModel {
  items: SettlementPayableCalculationItemReadModel[];
  note: string;
}

export interface SettlementLineReadModel {
  id: string;
  sourceType: "contract_bill_row" | "manual_adjustment";
  sourceLabel: string;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  calculationMode: "legacy" | "normal_auto" | "manual_amount" | "manual_adjustment";
  amount: string;
  amountCents: MoneyCents;
  reason: string;
  remark: string;
}

export interface SettlementDetailReadModel {
  id: string;
  settlementId: string;
  title: string;
  meta: DetailMetaItem[];
  baseInfo: DetailMetaItem[];
  effectivenessSteps: DetailStep[];
  archiveResponsibilities: string[];
  paymentRules: SettlementPaymentRuleReadModel[];
  settlementLines: SettlementLineReadModel[];
  payableCalculation: SettlementPayableCalculationReadModel;
  paymentBlockMessage: string;
  archiveFiles: EvidenceFileReadModel[];
  approvalTimeline: ApprovalTimelineItemReadModel[];
  availableActions: DetailActionReadModel[];
  primaryAction: string | null;
  disabledReasons: string[];
  chainLinks: BusinessChainLink[];
}

export interface PaymentDetailReadModel {
  id: string;
  title: string;
  meta: DetailMetaItem[];
  baseInfo: DetailMetaItem[];
  approvalSteps: DetailStep[];
  executionSteps: DetailStep[];
  executionAllocations: Array<{
    id: string;
    executionCode: string;
    settlementNo: string;
    stageName: string;
    allocationType: string;
    amountCents: MoneyCents;
  }>;
  executionCoverages: Array<{
    id: string;
    executionCode: string;
    paidAt: string;
    paidAmount: string;
    voucherName: string;
    financeRecordedAmount: string;
    unrecordedAmount: string;
    coverageStatus: string;
  }>;
  evidenceFiles: EvidenceFileReadModel[];
  approvalTimeline: ApprovalTimelineItemReadModel[];
  availableActions: DetailActionReadModel[];
  primaryAction: string | null;
  disabledReasons: string[];
  traceRules: string[];
  executionBlockMessage: string;
  chainLinks: BusinessChainLink[];
}

export type ContractPaymentApplicationSectionType =
  | "advance"
  | "progress"
  | "final"
  | "retention";

export interface ContractPaymentApplicationPreviewReadModel {
  contract: {
    contractId: string;
    contractVersionId: string;
    contractNo: string;
    contractName: string;
    contractVersion: string;
    projectId: string;
    projectName: string;
  };
  asOf: string;
  includedSettlements: Array<{
    settlementId: string;
    settlementNo: string;
    period: string;
    amountCents: MoneyCents;
    status: string;
    isFinal: boolean;
  }>;
  capacity: {
    cumulativeEffectiveSettlementCents: MoneyCents;
    systemCumulativeEffectiveSettlementCents?: MoneyCents;
    historicalSettledCents?: MoneyCents;
    duePayableCents: MoneyCents;
    occupiedCents: MoneyCents;
    historicalOccupiedCents?: MoneyCents;
    actualPaidCents: MoneyCents;
    approvalPendingCents: MoneyCents;
    approvedPendingCents: MoneyCents;
    proxyPaidCents: MoneyCents;
    historicalPaidCents?: MoneyCents;
    historicalApprovalPendingCents?: MoneyCents;
    historicalApprovedPendingCents?: MoneyCents;
    historicalProxyPaidCents?: MoneyCents;
    historicalRetentionWithheldCents?: MoneyCents;
    historicalRetentionReleasedCents?: MoneyCents;
    historicalOtherConfirmedOccupancyCents?: MoneyCents;
    advanceDeductionCents: MoneyCents;
    maxRequestableCents: MoneyCents;
  };
  advanceDeduction: {
    paidAdvanceCents: MoneyCents;
    systemPaidAdvanceCents?: MoneyCents;
    historicalAdvancePaidCents?: MoneyCents;
    historicalAdvanceDeductedCents?: MoneyCents;
    currentDeductionCents: MoneyCents;
    remainingAdvanceToDeductCents: MoneyCents;
  };
  capacityExplanation: Array<{
    label: string;
    amountCents: MoneyCents;
    operator: "add" | "subtract" | "result";
    note?: string;
    tone?: CoreFlowTone;
  }>;
  historicalBalance?: {
    settledCents: MoneyCents;
    approvalPendingPaymentCents: MoneyCents;
    approvedPendingPaymentCents: MoneyCents;
    paidCents: MoneyCents;
    proxyPaidCents: MoneyCents;
    advancePaidCents: MoneyCents;
    advanceDeductedCents: MoneyCents;
    retentionWithheldCents: MoneyCents;
    retentionReleasedCents: MoneyCents;
    otherConfirmedOccupancyCents: MoneyCents;
  };
  sections: Array<{
    type: ContractPaymentApplicationSectionType;
    title: string;
    rows: Array<{
      id: string;
      source: string;
      settlementId: string | null;
      settlementNo: string | null;
      currentSettlementAmountCents: MoneyCents;
      cumulativeBeforeAmountCents: MoneyCents;
      cumulativeAfterAmountCents: MoneyCents;
      effectiveAt: string | null;
      expectedPayableAt: string | null;
      paymentRule: string;
      invoiceRequirement: string;
      isDue: boolean;
      includableAmountCents: MoneyCents;
    }>;
  }>;
  formula: string;
}

export type ContractBusinessOptionSource = "system" | "historical_takeover";

export interface ContractBusinessOptionReadModel {
  contractId: string;
  contractVersionId: string | null;
  contractNo: string;
  contractName: string;
  counterparty: string;
  amountCents: MoneyCents;
  versionLabel: string;
  contractStatus: string;
  contractStatusLabel: string;
  source: ContractBusinessOptionSource;
  sourceLabel: string;
  takeoverLevel: string | null;
  takeoverStatus: string | null;
  takeoverStatusLabel: string | null;
  historicalBalanceConfirmedAt: string | null;
  canCreateSettlement: boolean;
  settlementUnavailableReason: string | null;
  canCreatePayment: boolean;
  paymentUnavailableReason: string | null;
  settlements: Array<{
    settlementId: string;
    settlementNo: string;
    periodLabel: string;
    amountCents: MoneyCents;
    payableAmountCents: MoneyCents;
    paidAmountCents: MoneyCents;
    status: string;
    statusLabel: string;
    canCreatePayment: boolean;
    unavailableReason: string | null;
  }>;
}

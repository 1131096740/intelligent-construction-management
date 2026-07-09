import type { BusinessAction } from "./permissions";

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
  createdAt: string;
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
}

export interface SettlementPaymentRuleReadModel {
  id: string;
  stage: string;
  ratio: string;
  accountPeriod: string;
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
  amount: string;
  amountCents: number;
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
    amountCents: number;
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
    amountCents: number;
    status: string;
    isFinal: boolean;
  }>;
  capacity: {
    cumulativeEffectiveSettlementCents: number;
    systemCumulativeEffectiveSettlementCents?: number;
    historicalSettledCents?: number;
    duePayableCents: number;
    occupiedCents: number;
    historicalOccupiedCents?: number;
    actualPaidCents: number;
    approvalPendingCents: number;
    approvedPendingCents: number;
    proxyPaidCents: number;
    historicalPaidCents?: number;
    historicalApprovalPendingCents?: number;
    historicalApprovedPendingCents?: number;
    historicalProxyPaidCents?: number;
    historicalOtherConfirmedOccupancyCents?: number;
    advanceDeductionCents: number;
    maxRequestableCents: number;
  };
  advanceDeduction: {
    paidAdvanceCents: number;
    systemPaidAdvanceCents?: number;
    historicalAdvancePaidCents?: number;
    historicalAdvanceDeductedCents?: number;
    currentDeductionCents: number;
    remainingAdvanceToDeductCents: number;
  };
  capacityExplanation: Array<{
    label: string;
    amountCents: number;
    operator: "add" | "subtract" | "result";
    note?: string;
    tone?: CoreFlowTone;
  }>;
  historicalBalance?: {
    settledCents: number;
    approvalPendingPaymentCents: number;
    approvedPendingPaymentCents: number;
    paidCents: number;
    proxyPaidCents: number;
    advancePaidCents: number;
    advanceDeductedCents: number;
    otherConfirmedOccupancyCents: number;
  };
  sections: Array<{
    type: ContractPaymentApplicationSectionType;
    title: string;
    rows: Array<{
      id: string;
      source: string;
      settlementId: string | null;
      settlementNo: string | null;
      currentSettlementAmountCents: number;
      cumulativeBeforeAmountCents: number;
      cumulativeAfterAmountCents: number;
      effectiveAt: string | null;
      expectedPayableAt: string | null;
      paymentRule: string;
      isDue: boolean;
      includableAmountCents: number;
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
  amountCents: number | string;
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
    amountCents: number;
    payableAmountCents: number;
    paidAmountCents: number;
    status: string;
    statusLabel: string;
    canCreatePayment: boolean;
    unavailableReason: string | null;
  }>;
}

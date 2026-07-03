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

export interface SettlementDetailReadModel {
  id: string;
  settlementId: string;
  title: string;
  meta: DetailMetaItem[];
  baseInfo: DetailMetaItem[];
  effectivenessSteps: DetailStep[];
  archiveResponsibilities: string[];
  paymentRules: SettlementPaymentRuleReadModel[];
  paymentBlockMessage: string;
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
    duePayableCents: number;
    occupiedCents: number;
    actualPaidCents: number;
    approvalPendingCents: number;
    approvedPendingCents: number;
    proxyPaidCents: number;
    advanceDeductionCents: number;
    maxRequestableCents: number;
  };
  advanceDeduction: {
    paidAdvanceCents: number;
    currentDeductionCents: number;
    remainingAdvanceToDeductCents: number;
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

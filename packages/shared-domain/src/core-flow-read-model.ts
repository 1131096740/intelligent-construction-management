export const CORE_FLOW_READ_ENDPOINTS = {
  contractDetail: "/contracts/:contractId",
  settlementDetail: "/settlements/:settlementId",
  paymentDetail: "/payments/:paymentId"
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
  traceRules: string[];
  executionBlockMessage: string;
  chainLinks: BusinessChainLink[];
}

export type ContractTakeoverLevel = "A" | "B" | "C";

export type ContractLifecycleStatus =
  | "signed_not_started"
  | "in_progress"
  | "suspended"
  | "completed"
  | "terminated"
  | "disputed";

export interface CreateContractTakeoverDto {
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
  takeoverLevelAdjustmentReason?: string;
  reviewComment?: string;
  acceptanceConclusion?: string;
}

export type UpdateContractTakeoverDto = CreateContractTakeoverDto;

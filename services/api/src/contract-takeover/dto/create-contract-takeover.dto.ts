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
  amountCents: string;
  signedAt: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText?: string;
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
}

export type UpdateContractTakeoverDto = CreateContractTakeoverDto;

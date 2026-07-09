import type { HistoricalContractPaymentBalance } from "./settlement-payment-capacity";

export const CONTRACT_TAKEOVER_BALANCE_SELECT = {
  id: true,
  contractId: true,
  contractVersionId: true,
  paymentTermsVersionId: true,
  takeoverStatus: true,
  historicalBalanceConfirmedAt: true,
  historicalSettledCents: true,
  historicalApprovalPendingPaymentCents: true,
  historicalApprovedPendingPaymentCents: true,
  historicalPaidCents: true,
  historicalProxyPaidCents: true,
  historicalAdvancePaidCents: true,
  historicalAdvanceDeductedCents: true,
  historicalRetentionWithheldCents: true,
  historicalRetentionReleasedCents: true,
  otherConfirmedOccupancyCents: true
} as const;

export interface ContractTakeoverBalanceRow {
  id: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  takeoverStatus: string;
  historicalBalanceConfirmedAt: Date | null;
  historicalSettledCents: bigint | number;
  historicalApprovalPendingPaymentCents: bigint | number;
  historicalApprovedPendingPaymentCents: bigint | number;
  historicalPaidCents: bigint | number;
  historicalProxyPaidCents: bigint | number;
  historicalAdvancePaidCents: bigint | number;
  historicalAdvanceDeductedCents: bigint | number;
  historicalRetentionWithheldCents: bigint | number;
  historicalRetentionReleasedCents: bigint | number;
  otherConfirmedOccupancyCents: bigint | number;
}

export function toHistoricalContractPaymentBalance(
  takeover: ContractTakeoverBalanceRow | null | undefined
): HistoricalContractPaymentBalance | undefined {
  if (
    !takeover ||
    takeover.takeoverStatus !== "confirmed" ||
    !takeover.historicalBalanceConfirmedAt
  ) {
    return undefined;
  }

  return {
    paymentTermsVersionId: takeover.paymentTermsVersionId,
    balanceConfirmedAt: takeover.historicalBalanceConfirmedAt,
    settledCents: takeover.historicalSettledCents,
    approvalPendingPaymentCents: takeover.historicalApprovalPendingPaymentCents,
    approvedPendingPaymentCents: takeover.historicalApprovedPendingPaymentCents,
    paidCents: takeover.historicalPaidCents,
    proxyPaidCents: takeover.historicalProxyPaidCents,
    advancePaidCents: takeover.historicalAdvancePaidCents,
    advanceDeductedCents: takeover.historicalAdvanceDeductedCents,
    retentionWithheldCents: takeover.historicalRetentionWithheldCents,
    retentionReleasedCents: takeover.historicalRetentionReleasedCents,
    otherConfirmedOccupancyCents: takeover.otherConfirmedOccupancyCents
  };
}

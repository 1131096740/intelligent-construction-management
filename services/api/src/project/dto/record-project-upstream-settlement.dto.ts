export interface RecordProjectUpstreamSettlementDto {
  settledAt: string;
  reportedAmountCents: string;
  approvedAmountCents: string;
  approvingPartyName: string;
  periodLabel: string;
  isFinal?: boolean;
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
}

export interface RecordProjectUpstreamSettlementDto {
  settledAt: string;
  reportedAmountCents: number;
  approvedAmountCents: number;
  approvingPartyName: string;
  periodLabel: string;
  isFinal?: boolean;
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
}

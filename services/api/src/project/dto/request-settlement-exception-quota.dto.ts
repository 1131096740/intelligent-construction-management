export interface RequestSettlementExceptionQuotaDto {
  contractId: string;
  amountCents: number;
  reason: string;
  validUntil: string;
  attachmentFileId: string;
}

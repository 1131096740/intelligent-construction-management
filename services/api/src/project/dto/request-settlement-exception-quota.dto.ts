export interface RequestSettlementExceptionQuotaDto {
  contractId: string;
  amountCents: string;
  reason: string;
  validUntil: string;
  attachmentFileId: string;
}

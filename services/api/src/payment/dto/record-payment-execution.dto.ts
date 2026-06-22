export interface RecordPaymentExecutionDto {
  amountCents: number;
  paidAt: string;
  executedByUserId: string;
  voucherFileId: string;
}

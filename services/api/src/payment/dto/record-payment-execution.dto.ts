export interface RecordPaymentExecutionDto {
  amountCents: string;
  paidAt: string;
  voucherFileId: string;
  confirmationPassword: string;
}

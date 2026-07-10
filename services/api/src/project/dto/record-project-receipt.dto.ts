export type ProjectReceiptSourceType =
  | "general_contractor_payment"
  | "owner_direct_payment"
  | "other";

export interface RecordProjectReceiptDto {
  receivedAt: string;
  amountCents: string;
  payerName: string;
  sourceType: ProjectReceiptSourceType;
  description?: string;
  voucherFileId: string;
  confirmationPassword: string;
}

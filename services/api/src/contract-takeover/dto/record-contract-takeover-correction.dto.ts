export type ContractTakeoverCorrectionType = "amount" | "payment_terms" | "evidence" | "other";

export interface RecordContractTakeoverCorrectionDto {
  correctionType: ContractTakeoverCorrectionType;
  reason: string;
  responsibleUserId: string;
  afterSummary: string;
  attachmentFileId: string;
  currentPassword: string;
}

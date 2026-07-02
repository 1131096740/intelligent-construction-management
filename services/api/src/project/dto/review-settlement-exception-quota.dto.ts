export interface ReviewSettlementExceptionQuotaDto {
  decision: "approve" | "reject";
  confirmationPassword: string;
  comment?: string;
}

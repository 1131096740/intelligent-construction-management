export interface ReviewProjectFinancingQuotaDto {
  decision: "approve" | "reject";
  confirmationPassword: string;
  comment?: string;
}

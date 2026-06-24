export interface ReviewPaymentApprovalDto {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
  comment?: string;
}

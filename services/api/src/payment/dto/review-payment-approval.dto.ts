export interface ReviewPaymentApprovalDto {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
  reviewedByUserId?: string;
}

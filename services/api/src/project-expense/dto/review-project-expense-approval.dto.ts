export interface ReviewProjectExpenseApprovalDto {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
  comment?: string;
}

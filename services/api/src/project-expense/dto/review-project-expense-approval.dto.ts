export interface ReviewProjectExpenseApprovalDto {
  decision: "approve" | "reject";
  approvedAmountCents?: string;
  comment?: string;
}

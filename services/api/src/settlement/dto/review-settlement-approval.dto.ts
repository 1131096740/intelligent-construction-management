export interface ReviewSettlementApprovalDto {
  decision: "approve" | "reject";
  reviewedByUserId: string;
}

export interface ReviewContractApprovalDto {
  decision: "approve" | "reject";
  reviewedByUserId: string;
}

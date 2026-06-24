export interface ReviewContractApprovalDto {
  decision: "approve" | "reject";
  comment?: string;
}

export interface ReviewContractApprovalDto {
  decision: "approve" | "reject" | "reject_previous" | "return_to_applicant";
  comment?: string;
}

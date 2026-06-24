export interface ReviewSettlementApprovalDto {
  decision: "approve" | "reject" | "reject_previous" | "return_to_applicant";
  comment?: string;
}

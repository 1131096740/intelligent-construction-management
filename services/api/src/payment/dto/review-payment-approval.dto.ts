export interface ReviewPaymentApprovalDto {
  decision: "approve" | "reject" | "reject_previous" | "return_to_applicant";
  approvedAmountCents?: number;
  comment?: string;
}

import { IsIn, IsString, ValidateIf } from "class-validator";

export class ReviewSettlementApprovalDto {
  @IsIn(["approve", "reject", "reject_previous", "return_to_applicant"], {
    message: "结算审批决定不正确"
  })
  decision!: "approve" | "reject" | "reject_previous" | "return_to_applicant";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算审批意见必须是文字" })
  comment?: string;
}

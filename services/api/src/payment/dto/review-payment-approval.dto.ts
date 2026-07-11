import { IsIn, IsString, Matches, ValidateIf } from "class-validator";

export class ReviewPaymentApprovalDto {
  @IsIn(["approve", "reject", "reject_previous", "return_to_applicant"], {
    message: "审批决定不正确"
  })
  decision!: "approve" | "reject" | "reject_previous" | "return_to_applicant";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "审批金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "审批金额必须按分填写为 0 或更大的整数" })
  approvedAmountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "审批意见必须是文字" })
  comment?: string;
}

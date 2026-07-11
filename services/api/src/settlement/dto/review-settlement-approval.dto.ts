import { IsIn, IsString, MaxLength, ValidateIf } from "class-validator";

export class ReviewSettlementApprovalDto {
  @IsIn(["approve", "reject", "reject_previous", "return_to_applicant"], {
    message: "结算审批决定不正确"
  })
  decision!: "approve" | "reject" | "reject_previous" | "return_to_applicant";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算审批意见必须是文字" })
  comment?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "自审原因必须是文字" })
  @MaxLength(500, { message: "自审原因不能超过 500 个字符" })
  selfReviewReason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "当前密码必须是文字" })
  @MaxLength(256, { message: "当前密码格式不正确" })
  confirmationPassword?: string;
}

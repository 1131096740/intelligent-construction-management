import { IsIn, IsString, ValidateIf } from "class-validator";
import { IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

export class ReviewContractApprovalDto {
  @IsIn(["approve", "reject", "reject_previous", "return_to_applicant"], {
    message: "合同审批决定不正确"
  })
  decision!: "approve" | "reject" | "reject_previous" | "return_to_applicant";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "审批意见必须是文字" })
  comment?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "自审原因必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "自审原因不能超过 500 个字符" })
  selfReviewReason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "当前密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" })
  confirmationPassword?: string;
}

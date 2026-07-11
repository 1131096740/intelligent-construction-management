import { IsIn, IsString, ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength
} from "../../validation/static-field-validation";

export class ReviewPaymentApprovalDto {
  @IsIn(["approve", "reject", "reject_previous", "return_to_applicant"], {
    message: "审批决定不正确"
  })
  decision!: "approve" | "reject" | "reject_previous" | "return_to_applicant";

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "审批金额格式不正确",
    formatMessage: "审批金额必须按分填写为 0 或更大的整数"
  })
  approvedAmountCents?: string;

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

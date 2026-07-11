import { IsIn, IsString, ValidateIf } from "class-validator";
import { IsCanonicalMoneyText } from "../../validation/static-field-validation";

export class ReviewProjectExpenseApprovalDto {
  @IsIn(["approve", "reject"], { message: "审批决定不正确" })
  decision!: "approve" | "reject";

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "审批金额格式不正确",
    formatMessage: "审批金额必须按分填写为 0 或更大的整数"
  })
  approvedAmountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "审批意见必须是文字" })
  comment?: string;
}

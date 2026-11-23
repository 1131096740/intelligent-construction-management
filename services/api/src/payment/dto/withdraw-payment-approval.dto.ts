import { IsOptionalNonBlankText } from "../../validation/static-field-validation";

export class WithdrawPaymentApprovalDto {
  @IsOptionalNonBlankText({ typeMessage: "审批轮次必须是文字", blankMessage: "审批轮次不能为空白" })
  expectedApprovalInstanceId?: string;
}

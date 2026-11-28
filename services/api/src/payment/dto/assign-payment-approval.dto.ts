import { IsISO8601, IsInt, Min, ValidateIf } from "class-validator";
import { IsOptionalNonBlankText, IsRequiredText } from "../../validation/static-field-validation";

export class AssignPaymentApprovalDto {
  @IsRequiredText({
    requiredMessage: "请选择接收人",
    typeMessage: "接收人编号必须是文字",
    blankMessage: "请选择接收人"
  })
  toUserId!: string;
}

export class DelegatePaymentApprovalDto extends AssignPaymentApprovalDto {
  @IsOptionalNonBlankText({ typeMessage: "审批轮次必须是文字", blankMessage: "审批轮次不能为空白" })
  expectedApprovalInstanceId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601({ strict: true }, { message: "审批轮次更新时间不正确" })
  expectedApprovalUpdatedAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: "审批职责必须是整数" })
  @Min(0, { message: "审批职责编号不能小于 0" })
  expectedNodeIndex?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601({ strict: true }, { message: "委托截止时间不正确" })
  endsAt?: string;
}

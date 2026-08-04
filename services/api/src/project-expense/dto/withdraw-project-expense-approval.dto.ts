import { IsISO8601, IsInt, Min } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class WithdrawProjectExpenseApprovalDto {
  @IsRequiredText({
    requiredMessage: "缺少预期项目支出版本",
    typeMessage: "预期项目支出版本格式不正确",
    blankMessage: "预期项目支出版本格式不正确"
  })
  @IsISO8601({}, { message: "预期项目支出版本格式不正确" })
  expectedExpenseUpdatedAt!: string;

  @IsRequiredText({
    requiredMessage: "缺少预期审批实例",
    typeMessage: "预期审批实例格式不正确",
    blankMessage: "预期审批实例不能为空白"
  })
  expectedApprovalInstanceId!: string;

  @IsInt({ message: "预期审批节点必须是整数" })
  @Min(0, { message: "预期审批节点不能小于 0" })
  expectedNodeIndex!: number;

  @IsRequiredText({
    requiredMessage: "缺少预期审批版本",
    typeMessage: "预期审批版本格式不正确",
    blankMessage: "预期审批版本格式不正确"
  })
  @IsISO8601({}, { message: "预期审批版本格式不正确" })
  expectedApprovalUpdatedAt!: string;
}

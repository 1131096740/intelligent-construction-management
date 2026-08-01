import { IsInt, Min } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class WithdrawSpotProcurementApprovalDto {
  @IsRequiredText({
    requiredMessage: "缺少预期采购版本",
    typeMessage: "预期采购版本格式不正确",
    blankMessage: "预期采购版本不能为空白"
  })
  expectedVersionId!: string;

  @IsRequiredText({
    requiredMessage: "缺少预期审批实例",
    typeMessage: "预期审批实例格式不正确",
    blankMessage: "预期审批实例不能为空白"
  })
  expectedApprovalInstanceId!: string;

  @IsInt({ message: "预期审批节点必须是整数" })
  @Min(0, { message: "预期审批节点不能小于 0" })
  expectedNodeIndex!: number;
}

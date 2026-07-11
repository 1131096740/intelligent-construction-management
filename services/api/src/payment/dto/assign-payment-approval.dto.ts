import { IsRequiredText } from "../../validation/static-field-validation";

export class AssignPaymentApprovalDto {
  @IsRequiredText({
    requiredMessage: "请选择接收人",
    typeMessage: "接收人编号必须是文字",
    blankMessage: "请选择接收人"
  })
  toUserId!: string;
}

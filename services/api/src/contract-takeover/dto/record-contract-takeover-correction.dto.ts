import { IsIn } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export type ContractTakeoverCorrectionType = "amount" | "payment_terms" | "evidence" | "other";

export class RecordContractTakeoverCorrectionDto {
  @IsIn(["amount", "payment_terms", "evidence", "other"], {
    message: "更正类型不正确"
  })
  correctionType!: ContractTakeoverCorrectionType;

  @IsRequiredText({
    requiredMessage: "请填写更正原因",
    typeMessage: "更正原因必须是文字",
    blankMessage: "请填写更正原因"
  })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "请填写更正责任人",
    typeMessage: "更正责任人编号必须是文字",
    blankMessage: "请填写更正责任人"
  })
  responsibleUserId!: string;

  @IsRequiredText({
    requiredMessage: "请填写更正后的事实说明",
    typeMessage: "更正后的事实说明必须是文字",
    blankMessage: "请填写更正后的事实说明"
  })
  afterSummary!: string;

  @IsRequiredText({
    requiredMessage: "请上传更正依据附件",
    typeMessage: "更正依据附件编号必须是文字",
    blankMessage: "请上传更正依据附件"
  })
  attachmentFileId!: string;

  @IsRequiredText({
    requiredMessage: "请填写当前登录密码后再保存接管更正记录",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请填写当前登录密码后再保存接管更正记录"
  })
  currentPassword!: string;
}

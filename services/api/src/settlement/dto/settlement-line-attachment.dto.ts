import { IsInt, Min } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class CreateSettlementLineAttachmentDto {
  @IsRequiredText({
    requiredMessage: "请选择要关联的附件",
    typeMessage: "附件编号必须是文字",
    blankMessage: "请选择要关联的附件"
  })
  fileId!: string;

  @IsRequiredText({
    requiredMessage: "请填写附件用途",
    typeMessage: "附件用途必须是文字",
    blankMessage: "请填写附件用途"
  })
  purpose!: string;

  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision!: number;
}

export class InvalidateSettlementLineAttachmentDto {
  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision!: number;
}

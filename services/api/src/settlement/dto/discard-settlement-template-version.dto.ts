import { IsRequiredText } from "../../validation/static-field-validation";
import { IsInt, Min } from "class-validator";
import { JsonSafeTemplateBodyDto } from "../../contract-template/dto/template-json-validation";

export class DiscardSettlementTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsInt({ message: "结算模板修订号必须是整数" })
  @Min(1, { message: "结算模板修订号必须大于 0" })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "请填写结算模板草稿废弃原因",
    typeMessage: "结算模板草稿废弃原因必须是文字",
    blankMessage: "请填写结算模板草稿废弃原因"
  })
  reason!: string;
}

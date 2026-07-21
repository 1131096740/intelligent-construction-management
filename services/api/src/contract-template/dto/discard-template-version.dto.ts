import { IsRequiredText } from "../../validation/static-field-validation";
import { IsDateString, IsInt, Min } from "class-validator";
import { JsonSafeTemplateBodyDto } from "./template-json-validation";

export class DiscardTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsDateString({ strict: true }, { message: "模板版本更新时间格式不正确" })
  expectedUpdatedAt!: string;

  @IsRequiredText({
    requiredMessage: "请填写模板草稿废弃原因",
    typeMessage: "模板草稿废弃原因必须是文字",
    blankMessage: "请填写模板草稿废弃原因"
  })
  reason!: string;
}

export class DiscardRevisionedTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsInt({ message: "版式模板修订号必须是整数" })
  @Min(1, { message: "版式模板修订号必须大于 0" })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "请填写模板草稿废弃原因",
    typeMessage: "模板草稿废弃原因必须是文字",
    blankMessage: "请填写模板草稿废弃原因"
  })
  reason!: string;
}

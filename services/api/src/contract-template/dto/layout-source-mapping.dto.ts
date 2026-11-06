import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsUUID, Matches, Max, Min, ValidateNested } from "class-validator";
import { JsonSafeTemplateBodyDto } from "./template-json-validation";
import { LAYOUT_MAPPING_FIELDS } from "../layout-field-mapping";

export class LayoutSourceBindingDto {
  @Matches(/^[a-f0-9]{64}$/u, { message: "请选择当前 Word 原文中的位置" })
  positionId!: string;

  @IsInt({ message: "原文起始位置必须是整数" })
  @Min(0, { message: "原文起始位置无效" })
  @Max(500_000, { message: "原文起始位置超出范围" })
  start!: number;

  @IsInt({ message: "原文结束位置必须是整数" })
  @Min(1, { message: "请选择需要自动填写的原文" })
  @Max(500_000, { message: "原文结束位置超出范围" })
  end!: number;

  @IsIn(LAYOUT_MAPPING_FIELDS.map(field => field.key), { message: "请选择可自动填写的合同字段" })
  fieldKey!: string;
}

export class ConfirmLayoutSourceMappingDto extends JsonSafeTemplateBodyDto {
  @IsInt({ message: "模板修订号必须是整数" })
  @Min(1, { message: "模板修订号无效" })
  expectedRevision!: number;

  @IsUUID("4", { message: "原文件信息无效，请重新读取模板" })
  sourceFileId!: string;

  @Matches(/^[a-f0-9]{64}$/u, { message: "原文件校验信息无效，请重新读取模板" })
  sourceSha256!: string;

  @Matches(/^[a-f0-9]{64}$/u, { message: "填写位置校验信息无效，请重新预览" })
  mappingFingerprint!: string;
}

export class SaveLayoutSourceMappingDto extends JsonSafeTemplateBodyDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsUUID("4")
  sourceFileId!: string;

  @Matches(/^[a-f0-9]{64}$/u)
  sourceSha256!: string;

  @IsArray({ message: "请逐项选择原文和自动填写字段" })
  @ArrayMinSize(1, { message: "请至少选择一个自动填写位置" })
  @ArrayMaxSize(128, { message: "自动填写位置超过模板限制" })
  @ValidateNested({ each: true })
  @Type(() => LayoutSourceBindingDto)
  bindings!: LayoutSourceBindingDto[];
}

import { IsInt, Min, ValidateIf } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";
import {
  IsJsonPlainRecord,
  JsonSafeTemplateBodyDto
} from "./template-json-validation";

export class CreateLayoutTemplateDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({ requiredMessage: "请填写版式名称", typeMessage: "版式名称必须是文字", blankMessage: "请填写版式名称" })
  name!: string;

  @IsRequiredText({ requiredMessage: "请选择合同类型", typeMessage: "合同类型必须是文字", blankMessage: "请选择合同类型" })
  contractTypeKey!: string;

  @IsRequiredText({ requiredMessage: "请选择 DOCX 版式源文件", typeMessage: "版式源文件编号必须是文字", blankMessage: "请选择 DOCX 版式源文件" })
  docxFileId!: string;

  @IsJsonPlainRecord({ message: "版式占位符结构必须是 JSON 对象" })
  placeholderSchema!: Record<string, unknown>;
}

export class LayoutTemplatePreviewSampleDataDto extends JsonSafeTemplateBodyDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "预览命名空间 contract 必须是 JSON 对象" })
  contract?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "预览命名空间 party 必须是 JSON 对象" })
  party?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "预览命名空间 field 必须是 JSON 对象" })
  field?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "预览命名空间 clause 必须是 JSON 对象" })
  clause?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "预览命名空间 bill 必须是 JSON 对象" })
  bill?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "预览命名空间 document 必须是 JSON 对象" })
  document?: Record<string, unknown>;
}

export class UpdateLayoutTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsInt({ message: "版式草稿修订号必须是整数" })
  @Min(1, { message: "版式草稿修订号必须大于零" })
  expectedRevision!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsRequiredText({ requiredMessage: "请选择 DOCX 版式源文件", typeMessage: "版式源文件编号必须是文字", blankMessage: "请选择 DOCX 版式源文件" })
  docxFileId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "版式占位符结构必须是 JSON 对象" })
  placeholderSchema?: Record<string, unknown>;
}

export class PublishTemplateChangeDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({ requiredMessage: "请填写模板发布说明", typeMessage: "模板发布说明必须是文字", blankMessage: "请填写模板发布说明" })
  changeSummary!: string;
}

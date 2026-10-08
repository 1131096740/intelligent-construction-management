import { IsInt, Min } from "class-validator";
import { JsonSafeTemplateBodyDto } from "../../contract-template/dto/template-json-validation";
import { IsRequiredText } from "../../validation/static-field-validation";
import { CreateSettlementTemplateDto, UpdateSettlementTemplateVersionDto } from "./settlement-template.dto";

export class CreateTemplateWorkbenchDto extends CreateSettlementTemplateDto {
  @IsInt({ message: "请刷新模板填写规则后重试" })
  @Min(1, { message: "请刷新模板填写规则后重试" })
  definitionVersion!: number;
}

export class UpdateTemplateWorkbenchDto extends UpdateSettlementTemplateVersionDto {
  @IsInt({ message: "请刷新模板填写规则后重试" })
  @Min(1, { message: "请刷新模板填写规则后重试" })
  definitionVersion!: number;
}

export class TemplateWorkbenchRevisionDto extends JsonSafeTemplateBodyDto {
  @IsInt({ message: "请刷新模板版本后重试" })
  @Min(1, { message: "请刷新模板版本后重试" })
  expectedRevision!: number;

  @IsInt({ message: "请刷新模板填写规则后重试" })
  @Min(1, { message: "请刷新模板填写规则后重试" })
  definitionVersion!: number;
}

export class PublishTemplateWorkbenchDto extends TemplateWorkbenchRevisionDto {
  @IsRequiredText({ requiredMessage: "请填写结算模板发布说明", typeMessage: "结算模板发布说明必须是文字", blankMessage: "请填写结算模板发布说明" })
  changeSummary!: string;
}

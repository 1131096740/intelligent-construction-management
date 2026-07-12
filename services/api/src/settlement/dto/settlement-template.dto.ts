import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Min,
  ValidateIf
} from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";
import {
  IsJsonPlainRecord,
  JsonSafeTemplateBodyDto
} from "../../contract-template/dto/template-json-validation";

class SettlementTemplateCompatibilityDto extends JsonSafeTemplateBodyDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "兼容合同类型必须是数组" })
  @ArrayUnique({ message: "兼容合同类型不能重复" })
  @IsString({ each: true, message: "兼容合同类型必须是文字" })
  @Matches(/^[a-z][a-z0-9_]{0,63}$/, {
    each: true,
    message: "兼容合同类型必须是系统已登记的安全字段码"
  })
  compatibleContractTypeKeys?: string[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "兼容金额角色必须是数组" })
  @ArrayUnique({ message: "兼容金额角色不能重复" })
  @IsIn(["included", "reference", "non_priced", "provisional"], {
    each: true,
    message: "兼容金额角色不在系统允许范围内"
  })
  compatibleAmountRoles?: string[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "兼容计价模式必须是数组" })
  @ArrayUnique({ message: "兼容计价模式不能重复" })
  @IsIn(["tax_inclusive", "tax_exclusive"], {
    each: true,
    message: "兼容计价模式不在系统允许范围内"
  })
  compatiblePricingModes?: string[];
}

export class CreateSettlementTemplateDto extends SettlementTemplateCompatibilityDto {
  @IsRequiredText({
    requiredMessage: "请填写结算模板名称",
    typeMessage: "结算模板名称必须是文字",
    blankMessage: "请填写结算模板名称"
  })
  name!: string;

  @IsRequiredText({
    requiredMessage: "请填写结算模板编码",
    typeMessage: "结算模板编码必须是文字",
    blankMessage: "请填写结算模板编码"
  })
  code!: string;

  @IsRequiredText({
    requiredMessage: "请选择 XLSX 模板源文件",
    typeMessage: "XLSX 模板源文件编号必须是文字",
    blankMessage: "请选择 XLSX 模板源文件"
  })
  xlsxFileId!: string;

  @IsJsonPlainRecord({ message: "结算模板列结构必须是 JSON 对象" })
  columnSchema!: Record<string, unknown>;

  @IsJsonPlainRecord({ message: "结算模板打印规则必须是 JSON 对象" })
  printRules!: Record<string, unknown>;

  @IsJsonPlainRecord({ message: "结算模板证据规则必须是 JSON 对象" })
  evidenceRules!: Record<string, unknown>;

  @IsJsonPlainRecord({ message: "结算模板异常规则必须是 JSON 对象" })
  anomalyRules!: Record<string, unknown>;
}

export class UpdateSettlementTemplateVersionDto extends SettlementTemplateCompatibilityDto {
  @IsInt({ message: "结算模板草稿修订号必须是整数" })
  @Min(1, { message: "结算模板草稿修订号必须大于零" })
  expectedRevision!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsRequiredText({
    requiredMessage: "请选择 XLSX 模板源文件",
    typeMessage: "XLSX 模板源文件编号必须是文字",
    blankMessage: "请选择 XLSX 模板源文件"
  })
  xlsxFileId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "结算模板列结构必须是 JSON 对象" })
  columnSchema?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "结算模板打印规则必须是 JSON 对象" })
  printRules?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "结算模板证据规则必须是 JSON 对象" })
  evidenceRules?: Record<string, unknown>;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonPlainRecord({ message: "结算模板异常规则必须是 JSON 对象" })
  anomalyRules?: Record<string, unknown>;
}

export class PublishSettlementTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({
    requiredMessage: "请填写结算模板发布说明",
    typeMessage: "结算模板发布说明必须是文字",
    blankMessage: "请填写结算模板发布说明"
  })
  changeSummary!: string;
}

export class SettlementTemplatePreviewDownloadDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({
    requiredMessage: "请填写预览下载原因",
    typeMessage: "预览下载原因必须是文字",
    blankMessage: "请填写预览下载原因"
  })
  downloadReason!: string;
}

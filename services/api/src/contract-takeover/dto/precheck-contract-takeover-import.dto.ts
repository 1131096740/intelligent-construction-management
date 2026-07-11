import { IsString, registerDecorator, ValidateIf } from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

export interface PrecheckContractTakeoverImportRowDto extends Record<string, unknown> {
  rowNo?: number;
}

type StaticRowsRule = {
  name: string;
  message: string;
  validate: (value: unknown) => boolean;
};

function registerStaticRowsRule(
  target: object,
  propertyKey: string | symbol,
  rule: StaticRowsRule
) {
  registerDecorator({
    name: rule.name,
    target: target.constructor,
    propertyName: String(propertyKey),
    options: { message: rule.message },
    validator: { validate: rule.validate }
  });
}

function isPlainImportRow(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function IsOpenImportRows(): PropertyDecorator {
  return (target, propertyKey) => {
    registerStaticRowsRule(target, propertyKey, {
      name: "staticTakeoverImportRowsArray",
      message: "历史合同导入行必须是数组",
      validate: Array.isArray
    });
    registerStaticRowsRule(target, propertyKey, {
      name: "staticTakeoverImportRowsSize",
      message: "单次历史合同导入必须保留 1 到 200 行数据",
      validate: (value) => !Array.isArray(value) || (value.length >= 1 && value.length <= 200)
    });
    registerStaticRowsRule(target, propertyKey, {
      name: "staticTakeoverImportRowsItems",
      message: "每行历史合同导入数据必须是对象",
      validate: (value) => !Array.isArray(value) || value.every(isPlainImportRow)
    });
  };
}

class ContractTakeoverImportRowsDto {
  @IsOpenImportRows()
  rows!: PrecheckContractTakeoverImportRowDto[];
}

export class PrecheckContractTakeoverImportDto extends ContractTakeoverImportRowsDto {
  @IsOptionalNonBlankText({
    typeMessage: "接管批次号必须是文字",
    blankMessage: "接管批次号不能为空白"
  })
  batchNo?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "接管截止日必须是文字" })
  @IsStrictDateOnly({ message: "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效" })
  takeoverCutoffDate?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管责任人编号必须是文字",
    blankMessage: "接管责任人编号不能为空白"
  })
  responsibleUserId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "批次复核意见必须是文字",
    blankMessage: "批次复核意见不能为空白"
  })
  reviewComment?: string;

  @IsOptionalNonBlankText({
    typeMessage: "批次验收结论必须是文字",
    blankMessage: "批次验收结论不能为空白"
  })
  acceptanceConclusion?: string;
}

export class CreateContractTakeoverImportDraftsDto extends ContractTakeoverImportRowsDto {
  @IsOptionalNonBlankText({
    typeMessage: "接管批次号必须是文字",
    blankMessage: "接管批次号不能为空白"
  })
  batchNo?: string;

  @IsRequiredText({
    requiredMessage: "请填写接管截止日后再生成接管草稿",
    typeMessage: "接管截止日必须是文字",
    blankMessage: "请填写接管截止日后再生成接管草稿"
  })
  @IsStrictDateOnly({ message: "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效" })
  takeoverCutoffDate!: string;

  @IsRequiredText({
    requiredMessage: "请填写接管责任人后再生成接管草稿",
    typeMessage: "接管责任人编号必须是文字",
    blankMessage: "请填写接管责任人后再生成接管草稿"
  })
  responsibleUserId!: string;

  @IsRequiredText({
    requiredMessage: "请填写批次复核意见后再生成接管草稿",
    typeMessage: "批次复核意见必须是文字",
    blankMessage: "请填写批次复核意见后再生成接管草稿"
  })
  reviewComment!: string;

  @IsRequiredText({
    requiredMessage: "请填写批次验收结论后再生成接管草稿",
    typeMessage: "批次验收结论必须是文字",
    blankMessage: "请填写批次验收结论后再生成接管草稿"
  })
  acceptanceConclusion!: string;
}

import { BadRequestException } from "@nestjs/common";
import { Transform } from "class-transformer";
import { registerDecorator } from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";
import { API_RAW_BODY_PREFLIGHT } from "../../validation/api-validation";

export interface PrecheckContractTakeoverImportRowDto extends Record<string, unknown> {
  rowNo?: number;
}

type StaticRowsRule = {
  name: string;
  message: string;
  validate: (value: unknown) => boolean;
};

const INVALID_REQUEST_MESSAGE = "提交内容格式不正确，请检查后重试";
const INVALID_IMPORT_ROW_MESSAGE = "每行历史合同导入数据必须是对象";

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
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function RejectUnsafeSourceImportRows(): PropertyDecorator {
  return Transform(
    ({ obj, key }) => {
      try {
        const rawRows = (obj as Record<string, unknown>)[key];
        if (Array.isArray(rawRows) && !rawRows.every(isPlainImportRow)) {
          throw new Error("invalid import row");
        }
        return rawRows;
      } catch {
        throw new BadRequestException({
          message: INVALID_REQUEST_MESSAGE,
          errors: [INVALID_IMPORT_ROW_MESSAGE]
        });
      }
    },
    { toClassOnly: true }
  );
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
      message: INVALID_IMPORT_ROW_MESSAGE,
      validate: (value) => !Array.isArray(value) || value.every(isPlainImportRow)
    });
  };
}

class ContractTakeoverImportRowsDto {
  static [API_RAW_BODY_PREFLIGHT](body: unknown) {
    try {
      if (body === null || typeof body !== "object") return;
      const rawRows = (body as Record<string, unknown>).rows;
      if (Array.isArray(rawRows) && !rawRows.every(isPlainImportRow)) {
        throw new Error("invalid import row");
      }
    } catch {
      throw new BadRequestException({
        message: INVALID_REQUEST_MESSAGE,
        errors: [INVALID_IMPORT_ROW_MESSAGE]
      });
    }
  }

  @RejectUnsafeSourceImportRows()
  @IsOpenImportRows()
  rows!: PrecheckContractTakeoverImportRowDto[];
}

export class PrecheckContractTakeoverImportDto extends ContractTakeoverImportRowsDto {
  @IsOptionalNonBlankText({
    typeMessage: "接管批次号必须是文字",
    blankMessage: "接管批次号不能为空白"
  })
  batchNo?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管截止日必须是文字",
    blankMessage: "接管截止日不能为空白"
  })
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

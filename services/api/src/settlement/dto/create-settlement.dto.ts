import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsString,
  registerDecorator,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsCanonicalSignedMoneyText,
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";
import {
  INVALID_SETTLEMENT_QUANTITY_MESSAGE,
  isSettlementQuantityInput
} from "../settlement-quantity";

export type SettlementLineSourceType =
  | "contract_bill_row"
  | "visa_change"
  | "manual_adjustment";

function IsSettlementQuantity(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "staticSettlementQuantityType",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: INVALID_SETTLEMENT_QUANTITY_MESSAGE },
      validator: {
        validate: isSettlementQuantityInput
      }
    });
  };
}

function IsRequiredSettlementLinesArray(): PropertyDecorator {
  return (target, propertyKey) => {
    const propertyName = String(propertyKey);
    registerDecorator({
      name: "requiredSettlementLinesPresent",
      target: target.constructor,
      propertyName,
      options: {
        message: "请至少选择一条本期真实发生的合同清单项或填写一条人工调整"
      },
      validator: { validate: (value) => value !== undefined && value !== null }
    });
    registerDecorator({
      name: "requiredSettlementLinesType",
      target: target.constructor,
      propertyName,
      options: { message: "结算明细必须是数组" },
      validator: {
        validate: (value) => value === undefined || value === null || Array.isArray(value)
      }
    });
    registerDecorator({
      name: "requiredSettlementLinesNotEmpty",
      target: target.constructor,
      propertyName,
      options: {
        message: "请至少选择一条本期真实发生的合同清单项或填写一条人工调整"
      },
      validator: {
        validate: (value, args) =>
          !Array.isArray(value) ||
          value.length > 0 ||
          (args?.object as CreateSettlementDto | undefined)?.isFinal === true
      }
    });
  };
}

export class CreateSettlementLineDto {
  @IsIn(["contract_bill_row", "visa_change", "manual_adjustment"], {
    message: "结算明细来源类型不正确"
  })
  sourceType!: SettlementLineSourceType;

  // 草稿行的稳定身份：用于附件在草稿修订及提交为正式结算后保持可追溯。
  // 正式创建接口仍可省略，服务端会按输入顺序兼容处理。
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算明细行标识必须是文字" })
  lineKey?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "合同清单项编号必须是文字" })
  contractBillRowId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "签证或变更项目类别必须是文字" })
  sourceItemType?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString({ strict: true }, { message: "签证或变更发生日期格式不正确" })
  occurredOn?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "签证或变更项目说明必须是文字" })
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "签证或变更计价依据必须是文字" })
  pricingBasis?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "负向调整来源必须是文字" })
  relatedSettlementLineId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算明细名称必须是文字" })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算明细单位必须是文字" })
  unit?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsSettlementQuantity()
  quantity?: number | string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "结算明细单价格式不正确",
    formatMessage: "结算明细单价必须按分填写为 0 或更大的整数",
    rangeMessage: "结算明细单价超出系统可保存范围"
  })
  unitPriceCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalSignedMoneyText({
    typeMessage: "结算明细金额格式不正确",
    formatMessage: "结算明细金额必须按分填写为整数",
    rangeMessage: "结算明细金额超出系统可保存范围"
  })
  amountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算明细原因必须是文字" })
  reason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算明细备注必须是文字" })
  remark?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: -2_147_483_648,
    max: 2_147_483_647,
    typeMessage: "结算明细排序必须是整数",
    rangeMessage: "结算明细排序超出系统可保存范围"
  })
  sortOrder?: number;
}

export class CreateSettlementDto {
  @IsRequiredText({
    requiredMessage: "请选择有效合同版本",
    typeMessage: "合同版本编号必须是文字",
    blankMessage: "请选择有效合同版本"
  })
  contractVersionId!: string;

  @IsRequiredText({
    requiredMessage: "请选择结算模板版本",
    typeMessage: "结算模板版本编号必须是文字",
    blankMessage: "请选择结算模板版本"
  })
  settlementTemplateVersionId?: string;

  @IsRequiredText({
    requiredMessage: "请填写结算编号",
    typeMessage: "结算编号必须是文字",
    blankMessage: "请填写结算编号"
  })
  code!: string;

  @IsRequiredText({
    requiredMessage: "请填写结算期间",
    typeMessage: "结算期间必须是文字",
    blankMessage: "请填写结算期间"
  })
  periodLabel!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "结算金额格式不正确",
    formatMessage: "结算金额必须按分填写为 0 或更大的整数"
  })
  amountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "是否最终结算必须是布尔值" })
  isFinal?: boolean;

  @IsRequiredSettlementLinesArray()
  @ValidateNested({ each: true, message: "每条结算明细必须是对象" })
  @Type(() => CreateSettlementLineDto)
  settlementLines?: CreateSettlementLineDto[];
}

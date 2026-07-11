import { Type } from "class-transformer";
import {
  IsBoolean,
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
  IsOptionalArray,
  IsRequiredText
} from "../../validation/static-field-validation";
import {
  INVALID_SETTLEMENT_QUANTITY_MESSAGE,
  isSettlementQuantityInput
} from "../settlement-quantity";

export type SettlementLineSourceType = "contract_bill_row" | "manual_adjustment";

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

export class CreateSettlementLineDto {
  @IsIn(["contract_bill_row", "manual_adjustment"], {
    message: "结算明细来源类型不正确"
  })
  sourceType!: SettlementLineSourceType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "合同清单项编号必须是文字" })
  contractBillRowId?: string;

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

  @IsCanonicalSignedMoneyText({
    typeMessage: "结算明细金额格式不正确",
    formatMessage: "结算明细金额必须按分填写为整数",
    rangeMessage: "结算明细金额超出系统可保存范围"
  })
  amountCents!: string;

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

  @IsCanonicalMoneyText({
    typeMessage: "结算金额格式不正确",
    formatMessage: "结算金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "是否最终结算必须是布尔值" })
  isFinal?: boolean;

  @IsOptionalArray({ typeMessage: "结算明细必须是数组" })
  @ValidateNested({ each: true, message: "每条结算明细必须是对象" })
  @Type(() => CreateSettlementLineDto)
  settlementLines?: CreateSettlementLineDto[];
}

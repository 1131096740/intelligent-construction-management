import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  registerDecorator,
  ValidateNested
} from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

const RECEIPT_QUANTITY_PATTERN =
  /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u;

export function isSpotProcurementReceiptQuantity(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    RECEIPT_QUANTITY_PATTERN.test(value)
  );
}

function IsReceiptQuantity(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "spotProcurementReceiptQuantity",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message:
          "收货数量必须是大于等于 0、最多 2 位小数且可保存的普通十进制字符串"
      },
      validator: {
        validate: isSpotProcurementReceiptQuantity
      }
    });
  };
}

export class UpdateReceiptDraftLineDto {
  @IsRequiredText({
    requiredMessage: "采购明细编号不能为空",
    typeMessage: "采购明细编号必须是文字",
    blankMessage: "采购明细编号不能为空"
  })
  procurementLineId!: string;

  @IsReceiptQuantity()
  qualifiedQuantity!: string;

  @IsReceiptQuantity()
  unqualifiedQuantity!: string;

  @IsOptionalNonBlankText({
    typeMessage: "不合格原因必须是文字",
    blankMessage: "不合格原因不能为空白"
  })
  unqualifiedReason?: string;

  @IsReceiptQuantity()
  freeGiftQuantity!: string;

  @IsBoolean({ message: "待补货标记必须是布尔值" })
  replenishmentPending!: boolean;

  @IsOptionalNonBlankText({
    typeMessage: "收货差异说明必须是文字",
    blankMessage: "收货差异说明不能为空白"
  })
  discrepancyNote?: string;
}

export class UpdateReceiptDraftDto {
  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "收货备注必须是文字",
    blankMessage: "收货备注不能为空白"
  })
  note?: string | null;

  @IsArray({ message: "收货明细必须是数组" })
  @ArrayMinSize(1, { message: "请填写全部收货明细" })
  @ValidateNested({ each: true, message: "每条收货明细必须是对象" })
  @Type(() => UpdateReceiptDraftLineDto)
  lines!: UpdateReceiptDraftLineDto[];
}

import { Prisma } from "@prisma/client";
import { registerDecorator } from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";
import { isUnicodeBlank } from "../../validation/unicode-whitespace";

const ORDINARY_DECIMAL = /^(0|[1-9]\d*)(?:\.\d+)?$/u;

export function isVatRateValue(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !ORDINARY_DECIMAL.test(value)
  ) {
    return false;
  }
  const decimalPlaces = value.includes(".")
    ? value.length - value.indexOf(".") - 1
    : 0;
  if (decimalPlaces > 2) return false;
  const [integerPart] = value.split(".");
  if (integerPart.length > 3) return false;
  return new Prisma.Decimal(value).lessThanOrEqualTo(100);
}

export function IsVatRateValue(): PropertyDecorator {
  return (target, propertyKey) => {
    const propertyName = String(propertyKey);
    registerDecorator({
      name: "vatRateValueType",
      target: target.constructor,
      propertyName,
      options: { message: "税率必须是普通十进制字符串" },
      validator: { validate: (value) => typeof value === "string" }
    });
    registerDecorator({
      name: "vatRateValueFormat",
      target: target.constructor,
      propertyName,
      options: { message: "税率必须是普通十进制字符串" },
      validator: {
        validate: (value) =>
          typeof value !== "string" || ORDINARY_DECIMAL.test(value)
      }
    });
    registerDecorator({
      name: "vatRateValueScale",
      target: target.constructor,
      propertyName,
      options: { message: "税率最多保留 2 位小数" },
      validator: {
        validate: (value) =>
          typeof value !== "string" ||
          !ORDINARY_DECIMAL.test(value) ||
          !value.includes(".") ||
          value.length - value.indexOf(".") - 1 <= 2
      }
    });
    registerDecorator({
      name: "vatRateValueRange",
      target: target.constructor,
      propertyName,
      options: { message: "税率必须在 0 到 100 之间" },
      validator: {
        validate: (value) =>
          typeof value !== "string" ||
          !ORDINARY_DECIMAL.test(value) ||
          isVatRateValue(value)
      }
    });
  };
}

export function IsVatRateLabel(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "vatRateLabelUnicodeBlank",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: "税率标签不能为空白" },
      validator: {
        validate: (value) =>
          typeof value !== "string" || !isUnicodeBlank(value)
      }
    });
  };
}

export class CreateVatRateOptionDto {
  @IsVatRateValue()
  rateValue!: string;

  @IsRequiredText({
    requiredMessage: "请填写税率标签",
    typeMessage: "税率标签必须是文字",
    blankMessage: "税率标签不能为空白"
  })
  @IsVatRateLabel()
  label!: string;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "税率排序必须是正整数",
    rangeMessage: "税率排序必须是正整数"
  })
  sortOrder!: number;
}

import { IsBoolean, ValidateIf } from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";
import {
  IsVatRateLabel,
  IsVatRateValue
} from "./create-vat-rate-option.dto";

export class UpdateVatRateOptionDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsVatRateValue()
  rateValue?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsRequiredText({
    requiredMessage: "请填写税率标签",
    typeMessage: "税率标签必须是文字",
    blankMessage: "税率标签不能为空白"
  })
  @IsVatRateLabel()
  label?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "税率启用状态必须是布尔值" })
  enabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "税率排序必须是正整数",
    rangeMessage: "税率排序必须是正整数"
  })
  sortOrder?: number;
}

import { IsArray, IsIn, ValidateIf } from "class-validator";
import { SPOT_PROCUREMENT_PAYMENT_METHODS, type SpotProcurementPaymentMethod } from "@jiangkong/shared-domain";
import { IsOptionalNonBlankText, IsRequiredText } from "../../validation/static-field-validation";

export class UpdateSpotPaymentPayerDto {
  @IsRequiredText({
    requiredMessage: "请选择付款主体",
    typeMessage: "付款主体编号必须是文字",
    blankMessage: "请选择付款主体"
  })
  companyEntityId!: string;

  @IsOptionalNonBlankText({
    typeMessage: "付款主体调整原因必须是文字",
    blankMessage: "付款主体调整原因不能为空白"
  })
  changeReason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "拟付款方式必须是数组" })
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, {
    each: true,
    message: "拟付款方式不正确"
  })
  paymentMethods?: SpotProcurementPaymentMethod[];
}

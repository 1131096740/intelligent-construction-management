import { IsMaxUnicodeTextLength, IsRequiredText } from "../../validation/static-field-validation";

export class VoidGlobalInvoiceDto {
  @IsRequiredText({ requiredMessage: "请填写作废原因", typeMessage: "作废原因必须是文字", blankMessage: "请填写作废原因" })
  @IsMaxUnicodeTextLength({ max: 100, message: "作废原因不能超过 100 个字符" })
  reasonCode!: string;

  @IsRequiredText({ requiredMessage: "请填写幂等键", typeMessage: "幂等键必须是文字", blankMessage: "请填写幂等键" })
  @IsMaxUnicodeTextLength({ max: 128, message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;
}

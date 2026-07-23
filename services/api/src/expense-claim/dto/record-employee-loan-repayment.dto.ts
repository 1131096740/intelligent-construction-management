import { IsString, ValidateIf } from "class-validator";
import { IsCanonicalMoneyText, IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

export class RecordEmployeeLoanRepaymentDto {
  @IsCanonicalMoneyText({ typeMessage: "还款金额格式不正确", formatMessage: "还款金额必须按分填写为大于 0 的整数" })
  amountCents!: string;
  @IsString({ message: "还款日期必须是文字" }) repaidAt!: string;
  @IsString({ message: "还款方式必须是文字" }) @IsMaxUnicodeTextLength({ max: 100, message: "还款方式不能超过 100 个字符" }) paymentMethod!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString({ message: "还款凭证必须是文字" }) voucherFileId?: string;
  @IsString({ message: "当前密码必须是文字" }) @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" }) confirmationPassword!: string;
}

export class ConfirmEmployeeLoanRepaymentDto {
  @IsString({ message: "当前密码必须是文字" }) @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" }) confirmationPassword!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString({ message: "确认说明必须是文字" }) @IsMaxUnicodeTextLength({ max: 500, message: "确认说明不能超过 500 个字符" }) confirmationNote?: string;
}

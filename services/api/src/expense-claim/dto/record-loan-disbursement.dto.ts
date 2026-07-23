import { IsString, ValidateIf } from "class-validator";
import { IsCanonicalMoneyText, IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

export class RecordLoanDisbursementDto {
  @IsCanonicalMoneyText({ typeMessage: "放款金额格式不正确", formatMessage: "放款金额必须按分填写为大于 0 的整数" })
  amountCents!: string;

  @IsString({ message: "放款日期必须是文字" })
  paidAt!: string;

  @IsString({ message: "放款方式必须是文字" })
  @IsMaxUnicodeTextLength({ max: 100, message: "放款方式不能超过 100 个字符" })
  paymentMethod!: string;

  @IsString({ message: "放款凭证不能为空" })
  voucherFileId!: string;

  @IsString({ message: "当前密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" })
  confirmationPassword!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "备注必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "备注不能超过 500 个字符" })
  note?: string;
}

import { IsDateString, IsIn, MaxLength } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export const PROCUREMENT_REFUND_METHODS = [
  "bank_transfer",
  "cash"
] as const;

export class RecordProcurementRefundDto {
  @IsCanonicalMoneyText({
    typeMessage: "退款到账金额格式不正确",
    formatMessage: "退款到账金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsDateString(
    { strict: true },
    { message: "退款实际到账日期格式不正确" }
  )
  receivedAt!: string;

  @IsIn(PROCUREMENT_REFUND_METHODS, {
    message: "退款到账方式不正确"
  })
  refundMethod!: (typeof PROCUREMENT_REFUND_METHODS)[number];

  @IsRequiredText({
    requiredMessage: "退款到账凭证不能为空",
    typeMessage: "退款到账凭证编号必须是文字",
    blankMessage: "退款到账凭证不能为空白"
  })
  @MaxLength(128, {
    message: "退款到账凭证编号不能超过 128 个字符"
  })
  voucherFileId!: string;

  @IsRequiredText({
    requiredMessage: "幂等键不能为空",
    typeMessage: "幂等键必须是文字",
    blankMessage: "幂等键不能为空白"
  })
  @MaxLength(128, { message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;
}

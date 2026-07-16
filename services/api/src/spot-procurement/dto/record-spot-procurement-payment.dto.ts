import { IsDateString, IsIn, MaxLength } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";
import { SPOT_PROCUREMENT_PAYMENT_METHODS } from "./update-spot-procurement-payment-draft.dto";

export class RecordSpotProcurementPaymentDto {
  @IsCanonicalMoneyText({
    typeMessage: "实付金额格式不正确",
    formatMessage: "实付金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsDateString({ strict: true }, { message: "实付日期格式不正确" })
  paidAt!: string;

  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, {
    message: "实际付款方式不正确"
  })
  paymentMethod!: (typeof SPOT_PROCUREMENT_PAYMENT_METHODS)[number];

  @IsRequiredText({
    requiredMessage: "付款凭证不能为空",
    typeMessage: "付款凭证编号必须是文字",
    blankMessage: "付款凭证不能为空白"
  })
  @MaxLength(128, { message: "付款凭证编号不能超过 128 个字符" })
  voucherFileId!: string;

  @IsRequiredText({
    requiredMessage: "幂等键不能为空",
    typeMessage: "幂等键必须是文字",
    blankMessage: "幂等键不能为空白"
  })
  @MaxLength(128, { message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  @MaxLength(256, { message: "当前密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

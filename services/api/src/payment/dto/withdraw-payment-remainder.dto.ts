import { IsISO8601 } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class WithdrawPaymentRemainderDto {
  @IsISO8601({}, { message: "付款申请更新时间不正确，请刷新后重试" })
  expectedUpdatedAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "调整后的待付金额格式不正确",
    formatMessage: "调整后的待付金额必须按分填写为 0 或更大的整数"
  })
  requestedAmountCents!: string;

  @IsOptionalNonBlankText({ typeMessage: "新付款单号必须是文字", blankMessage: "新付款单号不能为空白" })
  code?: string;

  @IsRequiredText({
    requiredMessage: "请填写调整原因",
    typeMessage: "调整原因必须是文字",
    blankMessage: "请填写调整原因"
  })
  @IsMaxUnicodeTextLength({ max: 200, message: "调整原因不能超过 200 个字" })
  reason!: string;
}

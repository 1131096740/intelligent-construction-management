import { IsISO8601 } from "class-validator";
import { IsCanonicalMoneyText, IsMaxUnicodeTextLength, IsOptionalNonBlankText } from "../../validation/static-field-validation";

export class RevisePaymentRequestDto {
  @IsISO8601({}, { message: "付款申请更新时间不正确，请刷新后重试" })
  expectedUpdatedAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "付款申请金额格式不正确",
    formatMessage: "付款申请金额必须按分填写为 0 或更大的整数"
  })
  requestedAmountCents!: string;

  @IsOptionalNonBlankText({ typeMessage: "本次付款事项必须是文字", blankMessage: "本次付款事项不能为空白" })
  @IsMaxUnicodeTextLength({ max: 500, message: "本次付款事项不能超过 500 个字" })
  paymentMatter?: string;

  @IsOptionalNonBlankText({ typeMessage: "金额计算说明必须是文字", blankMessage: "金额计算说明不能为空白" })
  @IsMaxUnicodeTextLength({ max: 2000, message: "金额计算说明不能超过 2000 个字" })
  amountCalculationExplanation?: string;
}

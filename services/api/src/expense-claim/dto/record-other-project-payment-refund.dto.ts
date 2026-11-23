import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

/** #405：其他项目付款的实际退款（复用 #400 PaymentExecutionRefund）。 */
export class RecordOtherProjectPaymentRefundDto {
  @IsCanonicalMoneyText({ typeMessage: "退款金额格式不正确", formatMessage: "退款金额必须按分填写为大于 0 的整数" })
  amountCents!: string;

  @IsRequiredText({ requiredMessage: "退款到账日期不能为空", typeMessage: "退款到账日期必须是文字", blankMessage: "退款到账日期不能为空白" })
  receivedAt!: string;

  @IsRequiredText({ requiredMessage: "退款原因不能为空", typeMessage: "退款原因必须是文字", blankMessage: "退款原因不能为空白" })
  reason!: string;

  @IsOptionalNonBlankText({ typeMessage: "资金账户编号必须是文字", blankMessage: "资金账户编号不能为空白" })
  accountId?: string;

  @IsOptionalNonBlankText({ typeMessage: "资金账户代码必须是文字", blankMessage: "资金账户代码不能为空白" })
  accountScopeKey?: string;

  @IsOptionalNonBlankText({ typeMessage: "退款依据必须是文字", blankMessage: "退款依据不能为空白" })
  evidenceReference?: string;

  @IsRequiredText({ requiredMessage: "退款登记幂等键不能为空", typeMessage: "退款登记幂等键必须是文字", blankMessage: "退款登记幂等键不能为空白" })
  idempotencyKey!: string;
}

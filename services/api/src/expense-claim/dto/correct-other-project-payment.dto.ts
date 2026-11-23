import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

/** #405：其他项目付款的已确认费用金额更正，仅财务主管确认。 */
export class CorrectOtherProjectPaymentDto {
  @IsCanonicalMoneyText({ typeMessage: "更正后金额格式不正确", formatMessage: "更正后金额必须按分填写为大于 0 的整数" })
  correctedAmountCents!: string;

  @IsRequiredText({ requiredMessage: "更正原因不能为空", typeMessage: "更正原因必须是文字", blankMessage: "更正原因不能为空白" })
  reason!: string;

  @IsRequiredText({ requiredMessage: "当前密码不能为空", typeMessage: "当前密码必须是文字", blankMessage: "当前密码不能为空白" })
  confirmationPassword!: string;

  @IsOptionalNonBlankText({ typeMessage: "自审原因必须是文字", blankMessage: "自审原因不能为空白" })
  selfReviewReason?: string;

  @IsRequiredText({ requiredMessage: "更正登记幂等键不能为空", typeMessage: "更正登记幂等键必须是文字", blankMessage: "更正登记幂等键不能为空白" })
  idempotencyKey!: string;
}

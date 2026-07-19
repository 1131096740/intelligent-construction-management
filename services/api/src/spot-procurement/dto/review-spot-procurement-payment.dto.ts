import {
  IsIn,
  IsOptional,
  IsString,
  ValidateIf
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";

export const SPOT_PROCUREMENT_PAYMENT_REVIEW_DECISIONS = [
  "approve",
  // Legacy payment approvals still read and process reject; real A5 rejects it in the service.
  "reject",
  "return_to_applicant"
] as const;

export type SpotProcurementPaymentReviewDecision =
  (typeof SPOT_PROCUREMENT_PAYMENT_REVIEW_DECISIONS)[number];

export class ReviewSpotProcurementPaymentDto {
  @IsIn(SPOT_PROCUREMENT_PAYMENT_REVIEW_DECISIONS, {
    message: "付款审批决定不正确"
  })
  decision!: SpotProcurementPaymentReviewDecision;

  @IsOptionalNonBlankText({
    typeMessage: "审批意见必须是文字",
    blankMessage: "审批意见不能为空白"
  })
  comment?: string;

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "调整后的供应商余额抵扣金额格式不正确",
    formatMessage:
      "调整后的供应商余额抵扣金额必须按分填写为 0 或更大的整数"
  })
  adjustedSupplierBalanceAmountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "自审原因必须是文字" })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "自审原因不能超过 500 个字符"
  })
  selfReviewReason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "当前密码必须是文字" })
  @IsMaxUnicodeTextLength({
    max: 256,
    message: "当前密码格式不正确"
  })
  confirmationPassword?: string;
}

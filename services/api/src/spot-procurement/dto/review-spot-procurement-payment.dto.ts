import { IsIn, IsOptional } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";

export const SPOT_PROCUREMENT_PAYMENT_REVIEW_DECISIONS = [
  "approve",
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
}

import { IsIn } from "class-validator";
import { IsOptionalNonBlankText } from "../../validation/static-field-validation";

export const RECEIPT_REVIEW_DECISIONS = [
  "approved",
  "returned"
] as const;

export type ReceiptReviewDecision =
  (typeof RECEIPT_REVIEW_DECISIONS)[number];

export class ReviewReceiptDto {
  @IsIn(RECEIPT_REVIEW_DECISIONS, {
    message: "收货复核结论不正确"
  })
  decision!: ReceiptReviewDecision;

  @IsOptionalNonBlankText({
    typeMessage: "收货复核意见必须是文字",
    blankMessage: "收货复核意见不能为空白"
  })
  comment?: string;
}

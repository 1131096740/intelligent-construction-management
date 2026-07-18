import { IsIn } from "class-validator";
import { IsOptionalNonBlankText } from "../../validation/static-field-validation";

export const SPOT_PROCUREMENT_REVIEW_DECISIONS = [
  "approve",
  "reject",
  "return_to_applicant"
] as const;

export type SpotProcurementReviewDecision =
  (typeof SPOT_PROCUREMENT_REVIEW_DECISIONS)[number];

export class ReviewSpotProcurementDto {
  @IsIn(SPOT_PROCUREMENT_REVIEW_DECISIONS, {
    message: "采购审批决定不正确"
  })
  decision!: SpotProcurementReviewDecision;

  @IsOptionalNonBlankText({
    typeMessage: "审批意见必须是文字",
    blankMessage: "审批意见不能为空白"
  })
  comment?: string;
}

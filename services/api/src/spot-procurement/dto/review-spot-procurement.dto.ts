import { IsIn, IsInt, Min } from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

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

  @IsRequiredText({
    requiredMessage: "缺少预期采购版本",
    typeMessage: "预期采购版本格式不正确",
    blankMessage: "预期采购版本不能为空白"
  })
  expectedVersionId!: string;

  @IsRequiredText({
    requiredMessage: "缺少预期审批实例",
    typeMessage: "预期审批实例格式不正确",
    blankMessage: "预期审批实例不能为空白"
  })
  expectedApprovalInstanceId!: string;

  @IsInt({ message: "预期审批节点必须是整数" })
  @Min(0, { message: "预期审批节点不能小于 0" })
  expectedNodeIndex!: number;

  @IsOptionalNonBlankText({
    typeMessage: "审批意见必须是文字",
    blankMessage: "审批意见不能为空白"
  })
  comment?: string;
}

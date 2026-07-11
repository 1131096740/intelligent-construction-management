import { IsIn } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export type ContractTakeoverImportBatchReviewStatus =
  | "under_review"
  | "accepted"
  | "limited_accepted"
  | "disputed";

export class ReviewContractTakeoverImportBatchDto {
  @IsIn(["under_review", "accepted", "limited_accepted", "disputed"], {
    message: "请选择正确的接管批次复核结果"
  })
  status!: ContractTakeoverImportBatchReviewStatus;

  @IsRequiredText({
    requiredMessage: "请填写批次复核意见后再提交复核结果",
    typeMessage: "批次复核意见必须是文字",
    blankMessage: "请填写批次复核意见后再提交复核结果"
  })
  reviewComment!: string;

  @IsRequiredText({
    requiredMessage: "请填写批次验收结论后再提交复核结果",
    typeMessage: "批次验收结论必须是文字",
    blankMessage: "请填写批次验收结论后再提交复核结果"
  })
  acceptanceConclusion!: string;
}

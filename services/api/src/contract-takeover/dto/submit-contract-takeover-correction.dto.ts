import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import {
  IsCanonicalSignedMoneyText,
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";

export const CONTRACT_TAKEOVER_CORRECTION_SCOPES = [
  "historical_settlement",
  "historical_payment",
  "historical_advance",
  "abnormal_overpay"
] as const;

export type ContractTakeoverCorrectionScope =
  (typeof CONTRACT_TAKEOVER_CORRECTION_SCOPES)[number];

export const CONTRACT_TAKEOVER_CORRECTION_OPERATIONS = [
  "correction",
  "reclassification",
  "reversal"
] as const;

export type ContractTakeoverCorrectionOperation =
  (typeof CONTRACT_TAKEOVER_CORRECTION_OPERATIONS)[number];

export class SubmitContractTakeoverCorrectionDto {
  @IsIn(CONTRACT_TAKEOVER_CORRECTION_SCOPES, {
    message: "历史更正范围不正确"
  })
  correctionScope!: ContractTakeoverCorrectionScope;

  @IsIn(CONTRACT_TAKEOVER_CORRECTION_OPERATIONS, {
    message: "历史更正动作不正确"
  })
  correctionOperation!: ContractTakeoverCorrectionOperation;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "目标事实修订必须是整数",
    rangeMessage: "目标事实修订必须大于 0"
  })
  targetRevision!: number;

  @IsOptional()
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "目标余额修订必须是整数",
    rangeMessage: "目标余额修订必须大于 0"
  })
  targetBalanceRevision?: number;

  @IsOptional()
  @IsCanonicalSignedMoneyText({
    typeMessage: "更正差额格式不正确",
    formatMessage: "更正差额必须按分填写为非零整数",
    rangeMessage: "更正差额超出系统可保存范围"
  })
  deltaCents?: string;

  @IsOptional()
  @IsString({ message: "目标历史实付编号必须是文字" })
  targetHistoricalPaymentId?: string;

  @IsOptional()
  @IsString({ message: "目标实付分配编号必须是文字" })
  targetAllocationId?: string;

  @IsOptional()
  @IsString({ message: "目标余额流水编号必须是文字" })
  targetBalanceEntryId?: string;

  @IsOptional()
  @IsIn(["historical_advance", "abnormal_overpay"], {
    message: "重分类目标不正确"
  })
  reclassificationTarget?: "historical_advance" | "abnormal_overpay";

  @IsRequiredText({
    requiredMessage: "请填写更正原因",
    typeMessage: "更正原因必须是文字",
    blankMessage: "请填写更正原因"
  })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "请填写更正责任人",
    typeMessage: "更正责任人编号必须是文字",
    blankMessage: "请填写更正责任人"
  })
  responsibleUserId!: string;

  @IsRequiredText({
    requiredMessage: "请上传独占的更正依据附件",
    typeMessage: "更正依据附件编号必须是文字",
    blankMessage: "请上传独占的更正依据附件"
  })
  attachmentFileId!: string;

  @IsUUID("4", { message: "更正应用幂等键必须是 UUID" })
  applicationIdempotencyKey!: string;

  @IsRequiredText({
    requiredMessage: "请填写当前登录密码后再提交历史更正",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请填写当前登录密码后再提交历史更正"
  })
  currentPassword!: string;
}

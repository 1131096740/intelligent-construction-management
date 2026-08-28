import { IsISO8601, IsInt, IsUUID, Matches, Min } from "class-validator";

import { IsRequiredText } from "../validation/static-field-validation";

export class AllocatePaymentExecutionDto {
  @IsRequiredText({ requiredMessage: "付款候选不能为空", typeMessage: "付款候选格式不正确", blankMessage: "付款候选不能为空白" })
  selectionRef!: string;

  @IsISO8601({}, { message: "付款候选有效期格式不正确" })
  selectionExpiresAt!: string;

  @Matches(/^[1-9]\d*$/u, { message: "核销金额格式不正确" })
  amountCents!: string;

  @IsInt({ message: "工资案件修订号必须是整数" })
  @Min(0, { message: "工资案件修订号不能为负数" })
  expectedCaseRevision!: number;

  @IsUUID("4", { message: "核销请求格式不正确" })
  idempotencyKey!: string;
}

export class PayableSettlementCaseCommandDto {
  @IsInt({ message: "核销案件修订号必须是整数" })
  @Min(1, { message: "核销案件修订号必须大于零" })
  expectedRevision!: number;

  @IsUUID("4", { message: "核销请求格式不正确" })
  idempotencyKey!: string;
}

export class ReturnInterEntityRelationshipDto {
  @Matches(/^[1-9]\d*$/u, { message: "归还金额格式不正确" })
  amountCents!: string;

  @IsRequiredText({ requiredMessage: "归还凭证不能为空", typeMessage: "归还凭证格式不正确", blankMessage: "归还凭证不能为空白" })
  evidenceFileId!: string;

  @IsUUID("4", { message: "归还凭证关系格式不正确" })
  evidenceClaimId!: string;

  @IsRequiredText({ requiredMessage: "归还原因不能为空", typeMessage: "归还原因格式不正确", blankMessage: "归还原因不能为空白" })
  reason!: string;

  @IsUUID("4", { message: "归还请求格式不正确" })
  idempotencyKey!: string;
}

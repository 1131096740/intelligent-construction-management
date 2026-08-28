import { IsISO8601, IsInt, IsUUID, Matches, Min } from "class-validator";

import { IsRequiredText } from "../validation/static-field-validation";

export class AllocatePaymentExecutionDto {
  @IsRequiredText({ requiredMessage: "付款候选引用不能为空", typeMessage: "付款候选引用格式不正确", blankMessage: "付款候选引用不能为空白" })
  selectionRef!: string;

  @IsISO8601({}, { message: "付款候选有效期格式不正确" })
  selectionExpiresAt!: string;

  @Matches(/^[1-9]\d*$/u, { message: "核销金额必须为正整数分" })
  amountCents!: string;

  @IsInt({ message: "工资案件修订号必须是整数" })
  @Min(0, { message: "工资案件修订号不能为负数" })
  expectedCaseRevision!: number;

  @IsUUID("4", { message: "核销幂等键必须是 UUID" })
  idempotencyKey!: string;
}

export class PayableSettlementCaseCommandDto {
  @IsInt({ message: "核销案件修订号必须是整数" })
  @Min(1, { message: "核销案件修订号必须大于零" })
  expectedRevision!: number;

  @IsUUID("4", { message: "核销幂等键必须是 UUID" })
  idempotencyKey!: string;
}

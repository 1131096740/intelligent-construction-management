import { IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";

export class RecordPaymentRefundDto {
  @IsString()
  @Matches(/^[1-9][0-9]{0,17}$/u, { message: "退款金额必须按分填写为大于 0 的整数" })
  amountCents!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u, { message: "退款到账日期格式不正确" })
  receivedAt!: string;

  @IsString()
  @Length(1, 2000, { message: "请填写退款原因" })
  reason!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/u, { message: "退款登记幂等键无效" })
  idempotencyKey!: string;

  @IsOptional()
  @IsUUID("4")
  accountId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  evidenceReference?: string;
}

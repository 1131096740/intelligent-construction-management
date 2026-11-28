import { IsOptional, IsString, Length, Matches } from "class-validator";

export class RequestPaymentCorrectionDto {
  @IsString()
  @Matches(/^[1-9][0-9]{0,17}$/u, { message: "更正后的金额必须按分填写为大于 0 的整数" })
  correctedAmountCents!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u, { message: "更正后的付款日期格式不正确" })
  correctedPaidAt!: string;

  @IsString()
  @Length(1, 2000, { message: "请填写更正原因" })
  correctionReason!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/u, { message: "更正申请幂等键无效" })
  idempotencyKey!: string;
}

export class ConfirmPaymentCorrectionDto {
  @IsString()
  @Length(1, 200)
  confirmationPassword!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/u, { message: "更正确认幂等键无效" })
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000, { message: "本人自审必须填写原因" })
  selfReviewReason?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reviewNote?: string;
}

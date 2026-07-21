import { IsISO8601, IsString, MaxLength, MinLength } from "class-validator";

export class AbandonPaymentRequestDto {
  @IsISO8601({}, { message: "付款申请更新时间不正确，请刷新后重试" })
  expectedUpdatedAt!: string;

  @IsString({ message: "放弃原因必须是文字" })
  @MinLength(1, { message: "放弃原因不能为空" })
  @MaxLength(200, { message: "放弃原因不能超过 200 个字" })
  reason!: string;
}

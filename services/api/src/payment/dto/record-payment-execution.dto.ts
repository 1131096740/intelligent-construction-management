import { IsDateString, IsNotEmpty, IsString, Matches } from "class-validator";

export class RecordPaymentExecutionDto {
  @IsString({ message: "实付金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "实付金额必须按分填写为 0 或更大的整数" })
  amountCents!: string;

  @IsDateString({ strict: true }, { message: "付款日期格式不正确" })
  paidAt!: string;

  @IsString({ message: "付款凭证编号必须是文字" })
  @IsNotEmpty({ message: "付款凭证不能为空" })
  @Matches(/\S/u, { message: "付款凭证不能为空白" })
  voucherFileId!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}

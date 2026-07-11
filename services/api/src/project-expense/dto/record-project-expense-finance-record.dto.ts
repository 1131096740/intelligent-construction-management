import { IsDateString, IsNotEmpty, IsString, Matches } from "class-validator";

export class RecordProjectExpenseFinanceRecordDto {
  @IsString({ message: "财务入账金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "财务入账金额必须按分填写为 0 或更大的整数" })
  amountCents!: string;

  @IsDateString({ strict: true }, { message: "入账日期格式不正确" })
  occurredAt!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}

import { IsDateString, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class RecordProjectExpensePurchaseExecutionDto {
  @IsDateString({ strict: true }, { message: "采购执行日期格式不正确" })
  executedAt!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "采购说明必须是文字" })
  note?: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}

import { IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class ConfirmProjectExpenseReceiptDto {
  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "收货说明必须是文字" })
  note?: string;
}

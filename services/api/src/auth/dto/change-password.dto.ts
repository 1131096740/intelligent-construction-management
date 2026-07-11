import { IsNotEmpty, IsString, Matches } from "class-validator";

export class ChangePasswordDto {
  @IsString({ message: "当前密码必须是字符串" })
  @IsNotEmpty({ message: "请输入当前密码" })
  oldPassword!: string;

  @IsString({ message: "新密码必须是字符串" })
  @IsNotEmpty({ message: "请输入新密码" })
  @Matches(/\S/u, { message: "新密码不能全为空白字符" })
  newPassword!: string;
}

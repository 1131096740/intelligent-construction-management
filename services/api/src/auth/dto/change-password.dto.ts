import { IsNotEmpty, IsString } from "class-validator";

export class ChangePasswordDto {
  @IsString({ message: "当前密码必须是字符串" })
  @IsNotEmpty({ message: "请输入当前密码" })
  oldPassword!: string;

  @IsString({ message: "新密码必须是字符串" })
  @IsNotEmpty({ message: "请输入新密码" })
  newPassword!: string;
}

import { IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";
import { IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

export class ChangePasswordDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "姓名必须是字符串" })
  @Matches(/\S/u, { message: "请输入真实姓名" })
  @IsMaxUnicodeTextLength({ max: 100, message: "姓名不能超过 100 个字符" })
  name?: string;

  @IsString({ message: "当前密码必须是字符串" })
  @IsNotEmpty({ message: "请输入当前密码" })
  oldPassword!: string;

  @IsString({ message: "新密码必须是字符串" })
  @IsNotEmpty({ message: "请输入新密码" })
  @Matches(/\S/u, { message: "新密码不能全为空白字符" })
  newPassword!: string;
}

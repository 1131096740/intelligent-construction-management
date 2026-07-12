import { IsString, Matches } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class UpdateMyProfileDto {
  @IsRequiredText({
    requiredMessage: "请输入真实姓名",
    typeMessage: "姓名必须是字符串",
    blankMessage: "请输入真实姓名"
  })
  @IsMaxUnicodeTextLength({ max: 100, message: "姓名不能超过 100 个字符" })
  name!: string;

  @IsString({ message: "手机号必须是字符串" })
  @Matches(/^1[3-9]\d{9}$/u, { message: "请输入正确的中国大陆手机号" })
  phone!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前密码",
    typeMessage: "当前密码必须是字符串",
    blankMessage: "请输入当前密码"
  })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前密码不能超过 256 个字符" })
  currentPassword!: string;
}

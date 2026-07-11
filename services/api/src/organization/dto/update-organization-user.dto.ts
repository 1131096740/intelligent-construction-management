import { IsBoolean, IsString, Matches, ValidateIf } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class UpdateOrganizationUserDto {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: "部门标识必须是文字" })
  @Matches(/\S/u, { message: "部门标识不能为空白" })
  @IsMaxUnicodeTextLength({ max: 128, message: "部门标识不能超过 128 个字符" })
  departmentId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "人员状态必须是布尔值" })
  isActive?: boolean;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前登录密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

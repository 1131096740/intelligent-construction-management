import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";
import { IsString, Matches, ValidateIf } from "class-validator";

export class CreateDepartmentDto {
  @IsRequiredText({
    requiredMessage: "请填写部门名称",
    typeMessage: "部门名称必须是文字",
    blankMessage: "请填写部门名称"
  })
  @IsMaxUnicodeTextLength({ max: 100, message: "部门名称不能超过 100 个字符" })
  name!: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: "上级部门标识必须是文字" })
  @Matches(/\S/u, { message: "上级部门标识不能为空白" })
  @IsMaxUnicodeTextLength({ max: 128, message: "上级部门标识不能超过 128 个字符" })
  parentId?: string | null;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前登录密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

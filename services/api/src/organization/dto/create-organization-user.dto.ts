import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { IsIn, IsOptional, IsString, Matches, MinLength, ValidateIf } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreateOrganizationUserDto {
  @IsOptional()
  @IsRequiredText({
    requiredMessage: "请填写人员姓名",
    typeMessage: "人员姓名必须是文字",
    blankMessage: "请填写人员姓名"
  })
  @IsString({ message: "人员姓名必须是文字" })
  @IsMaxUnicodeTextLength({ max: 100, message: "人员姓名不能超过 100 个字符" })
  name?: string;

  @IsString({ message: "手机号必须是文字" })
  @Matches(/^1[3-9]\d{9}$/u, { message: "手机号格式不正确" })
  phone!: string;

  @IsRequiredText({
    requiredMessage: "请选择部门",
    typeMessage: "部门标识必须是文字",
    blankMessage: "部门标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "部门标识不能超过 128 个字符" })
  departmentId!: string;

  @IsOptional()
  @IsIn(ROLE_KEYS, { message: "初始岗位不在固定岗位清单中" })
  initialRoleKey?: RoleKey;

  @ValidateIf((value: CreateOrganizationUserDto) => value.projectId !== undefined)
  @IsString({ message: "项目标识必须是文字" })
  @IsMaxUnicodeTextLength({ max: 128, message: "项目标识不能超过 128 个字符" })
  projectId?: string;

  @IsRequiredText({
    requiredMessage: "请生成临时密码",
    typeMessage: "临时密码必须是文字",
    blankMessage: "临时密码不能全为空白字符"
  })
  @MinLength(8, { message: "临时密码至少需要 8 个字符" })
  @IsMaxUnicodeTextLength({ max: 256, message: "临时密码不能超过 256 个字符" })
  temporaryPassword!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前登录密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

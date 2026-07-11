import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { IsIn, IsOptional, IsString, Matches, ValidateIf } from "class-validator";
import { IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

export class ApplyRoleRemovalDto {
  @IsIn(["remove"], { message: "只支持撤销岗位" })
  operation!: "remove";

  @IsString({ message: "人员标识必须是文字" })
  @Matches(/\S/u, { message: "人员标识不能为空白" })
  @IsMaxUnicodeTextLength({ max: 128, message: "人员标识不能超过 128 个字符" })
  userId!: string;

  @IsIn(["global", "project"], { message: "岗位范围不正确" })
  scope!: "global" | "project";

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString({ message: "项目标识必须是文字" })
  @Matches(/\S/u, { message: "项目标识不能为空白" })
  @IsMaxUnicodeTextLength({ max: 128, message: "项目标识不能超过 128 个字符" })
  projectId?: string | null;

  @IsIn(ROLE_KEYS, { message: "岗位键不正确" })
  roleKey!: RoleKey;

  @IsString({ message: "快照标识必须是文字" })
  @Matches(/^sha256:[0-9a-f]{64}$/u, { message: "快照标识格式不正确" })
  snapshotHash!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前登录密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

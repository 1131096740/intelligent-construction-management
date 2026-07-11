import { IsString, Matches } from "class-validator";
import { IsMaxUnicodeTextLength } from "../../validation/static-field-validation";
import { PreviewRoleAdditionDto } from "./preview-role-addition.dto";

export class ApplyRoleAdditionDto extends PreviewRoleAdditionDto {
  @IsString({ message: "快照标识必须是文字" })
  @Matches(/^sha256:[0-9a-f]{64}$/u, { message: "快照标识格式不正确" })
  snapshotHash!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前登录密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

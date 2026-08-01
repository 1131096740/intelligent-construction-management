import { IsUUID, Matches } from "class-validator";
import { IsMaxUnicodeTextLength, IsRequiredText } from "../../validation/static-field-validation";

export class TerminateProjectFinancingQuotaDto {
  @IsUUID("4", { message: "终止 actionId 必须是 UUIDv4" })
  actionId!: string;

  @Matches(/^[a-f0-9]{64}$/u, { message: "终止生命周期令牌无效" })
  expectedLifecycleToken!: string;

  @IsRequiredText({
    requiredMessage: "请填写项目垫资额度终止原因",
    typeMessage: "项目垫资额度终止原因必须是文字",
    blankMessage: "请填写项目垫资额度终止原因"
  })
  @IsMaxUnicodeTextLength({ max: 500, message: "项目垫资额度终止原因不能超过 500 个字符" })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前登录密码格式不正确" })
  confirmationPassword!: string;
}

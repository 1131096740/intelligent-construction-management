import { IsUUID } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class ConfirmProjectUpstreamFundFactDto {
  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;

  @IsUUID("4", { message: "上游资金确认幂等键必须是 UUID" })
  confirmationActionId!: string;
}

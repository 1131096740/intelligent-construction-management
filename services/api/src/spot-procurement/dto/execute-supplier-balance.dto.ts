import { MaxLength } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class ExecuteSupplierBalanceDto {
  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  @MaxLength(256, { message: "当前密码不能超过 256 个字符" })
  confirmationPassword!: string;
}

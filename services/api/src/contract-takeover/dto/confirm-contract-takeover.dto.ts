import { IsRequiredText } from "../../validation/static-field-validation";

export class ConfirmContractTakeoverDto {
  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;
}

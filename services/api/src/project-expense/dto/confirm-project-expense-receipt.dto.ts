import { IsString, ValidateIf } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class ConfirmProjectExpenseReceiptDto {
  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "收货说明必须是文字" })
  note?: string;
}

import { IsDateString, IsString, ValidateIf } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class RecordProjectExpensePurchaseExecutionDto {
  @IsDateString({ strict: true }, { message: "采购执行日期格式不正确" })
  executedAt!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "采购说明必须是文字" })
  note?: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;
}

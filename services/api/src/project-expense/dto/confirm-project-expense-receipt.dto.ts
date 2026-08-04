import {
  IsISO8601,
  IsString,
  IsUUID,
  ValidateIf
} from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class ConfirmProjectExpenseReceiptDto {
  @IsRequiredText({
    requiredMessage: "缺少预期项目支出版本",
    typeMessage: "预期项目支出版本格式不正确",
    blankMessage: "预期项目支出版本格式不正确"
  })
  @IsISO8601({}, { message: "预期项目支出版本格式不正确" })
  expectedExpenseUpdatedAt!: string;

  @IsUUID("4", { message: "收货确认幂等键必须是 UUID" })
  idempotencyKey!: string;

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

import { IsDateString } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RecordFinanceRecordDto {
  @IsCanonicalMoneyText({
    typeMessage: "财务入账金额格式不正确",
    formatMessage: "财务入账金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsDateString({ strict: true }, { message: "入账日期格式不正确" })
  occurredAt!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;
}

import { IsDateString, IsISO8601, IsUUID } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RecordProjectExpenseFinanceRecordDto {
  @IsRequiredText({
    requiredMessage: "缺少预期项目支出版本",
    typeMessage: "预期项目支出版本格式不正确",
    blankMessage: "预期项目支出版本格式不正确"
  })
  @IsISO8601({}, { message: "预期项目支出版本格式不正确" })
  expectedExpenseUpdatedAt!: string;

  @IsUUID("4", { message: "项目支出财务入账幂等键必须是 UUID" })
  idempotencyKey!: string;

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

import { IsDateString } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RecordProjectExpenseExecutionDto {
  @IsCanonicalMoneyText({
    typeMessage: "实付金额格式不正确",
    formatMessage: "实付金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsDateString({ strict: true }, { message: "付款日期格式不正确" })
  paidAt!: string;

  @IsRequiredText({
    requiredMessage: "付款凭证不能为空",
    typeMessage: "付款凭证编号必须是文字",
    blankMessage: "付款凭证不能为空白"
  })
  voucherFileId!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;
}

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

/**
 * A wage payment can contain more than one creditor. The client supplies only
 * the already-issued WagePayableRef and an amount; all creditor identity and
 * company/project snapshots are re-read and frozen by the payment transaction.
 */
export class WagePayableExecutionBindingDto {
  @IsUUID("4", { message: "工资应付引用必须是 UUID" })
  payableRef!: string;

  @IsCanonicalMoneyText({
    typeMessage: "工资债权关联金额格式不正确",
    formatMessage: "工资债权关联金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;
}

export class RecordPaymentExecutionDto {
  @IsRequiredText({
    requiredMessage: "缺少预期付款申请版本",
    typeMessage: "预期付款申请版本格式不正确",
    blankMessage: "预期付款申请版本格式不正确"
  })
  @IsISO8601({}, { message: "预期付款申请版本格式不正确" })
  expectedPaymentUpdatedAt!: string;

  @IsUUID("4", { message: "付款实付登记幂等键必须是 UUID" })
  idempotencyKey!: string;

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

  @IsOptional()
  @IsArray({ message: "工资债权关联必须是数组" })
  @ArrayMaxSize(100, { message: "工资债权关联不能超过 100 条" })
  @ValidateNested({ each: true, message: "工资债权关联格式不正确" })
  @Type(() => WagePayableExecutionBindingDto)
  wagePayableBindings?: WagePayableExecutionBindingDto[];
}

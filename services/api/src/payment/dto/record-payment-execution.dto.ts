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
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

/**
 * A wage payment can contain more than one creditor. The client supplies only
 * the already-issued WagePayableRef and an amount; all creditor identity and
 * company/project snapshots are re-read and frozen by the payment transaction.
 */
export class WagePayableExecutionBindingDto {
  @IsUUID("4", { message: "工资应付引用格式不正确" })
  payableRef!: string;

  @IsCanonicalMoneyText({
    typeMessage: "工资债权关联金额格式不正确",
    formatMessage: "工资债权关联金额格式不正确"
  })
  amountCents!: string;
}

export class PaymentExecutionProxyAuthorizationDto {
  @IsRequiredText({
    requiredMessage: "跨主体付款授权原因不能为空",
    typeMessage: "跨主体付款授权原因必须是文字",
    blankMessage: "跨主体付款授权原因不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 500, message: "跨主体付款授权原因不能超过 500 个字" })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "跨主体付款授权证据不能为空",
    typeMessage: "跨主体付款授权证据格式不正确",
    blankMessage: "跨主体付款授权证据不能为空白"
  })
  evidenceFileId!: string;

  @IsRequiredText({
    requiredMessage: "重新授权引用不能为空",
    typeMessage: "重新授权引用格式不正确",
    blankMessage: "重新授权引用不能为空白"
  })
  reauthorizationReference!: string;

  @IsRequiredText({
    requiredMessage: "重新授权人不能为空",
    typeMessage: "重新授权人格式不正确",
    blankMessage: "重新授权人不能为空白"
  })
  reauthorizedByUserId!: string;

  @IsISO8601({}, { message: "重新授权时间格式不正确" })
  reauthorizedAt!: string;
}

export class PaymentExecutionPayerAttestationDto {
  @IsRequiredText({
    requiredMessage: "服务端银行账户核验引用不能为空",
    typeMessage: "服务端银行账户核验引用格式不正确",
    blankMessage: "服务端银行账户核验引用不能为空白"
  })
  /** Opaque reference issued by the server-side bank-holder authority. */
  bankAccountReference!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentExecutionProxyAuthorizationDto)
  proxyAuthorization?: PaymentExecutionProxyAuthorizationDto;
}

export class RecordPaymentExecutionDto {
  @IsRequiredText({
    requiredMessage: "缺少预期付款申请版本",
    typeMessage: "预期付款申请版本格式不正确",
    blankMessage: "预期付款申请版本格式不正确"
  })
  @IsISO8601({}, { message: "预期付款申请版本格式不正确" })
  expectedPaymentUpdatedAt!: string;

  @IsUUID("4", { message: "付款实付登记请求格式不正确" })
  idempotencyKey!: string;

  @IsCanonicalMoneyText({
    typeMessage: "实付金额格式不正确",
    formatMessage: "实付金额格式不正确"
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

  @IsOptional()
  @ValidateNested({ message: "付款主体核验格式不正确" })
  @Type(() => PaymentExecutionPayerAttestationDto)
  payerAttestation?: PaymentExecutionPayerAttestationDto;
}

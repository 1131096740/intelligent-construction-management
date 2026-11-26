import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsObject, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { IsCanonicalMoneyText, IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

class ExpenseClaimRegisteredAllocationDto {
  @IsUUID("4", { message: "请选择有效的资金来源" })
  sourceBatchId!: string;

  @IsCanonicalMoneyText({ typeMessage: "来源分摊金额格式不正确", formatMessage: "来源分摊金额须为大于 0 的整数分" })
  amountCents!: string;
}

class ExpenseClaimCashCostAllocationDto {
  @IsUUID("4", { message: "请选择有效的原确认费用明细" })
  costImpactId!: string;

  @IsCanonicalMoneyText({ typeMessage: "费用分摊金额格式不正确", formatMessage: "费用分摊金额须为大于 0 的整数分" })
  amountCents!: string;
}

class ExpenseClaimRegisteredFundingDto {
  @IsString({ message: "请选择登记资金账户" })
  @MinLength(1)
  @MaxLength(200)
  scopeKey!: string;

  @IsUUID("4", { message: "请重新选择有效的余额核对版本" })
  expectedRegistrationId!: string;

  @IsArray({ message: "请逐笔选择资金来源" })
  @ArrayNotEmpty({ message: "请至少选择一个资金来源" })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExpenseClaimRegisteredAllocationDto)
  sourceAllocations!: ExpenseClaimRegisteredAllocationDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "请逐笔填写现金支付的原确认费用明细" })
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExpenseClaimCashCostAllocationDto)
  costAllocations?: ExpenseClaimCashCostAllocationDto[];
}

export class RecordExpenseClaimPaymentDto {
  @IsCanonicalMoneyText({ typeMessage: "补付金额格式不正确", formatMessage: "补付金额必须按分填写为大于 0 的整数" })
  amountCents!: string;

  @IsString({ message: "付款日期必须是文字" })
  paidAt!: string;

  @IsString({ message: "付款方式必须是文字" })
  @IsMaxUnicodeTextLength({ max: 100, message: "付款方式不能超过 100 个字符" })
  paymentMethod!: string;

  @IsString({ message: "付款凭证不能为空" })
  voucherFileId!: string;

  @IsString({ message: "当前密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" })
  confirmationPassword!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "备注必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "备注不能超过 500 个字符" })
  note?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: "登记资金资料必须是对象" })
  @ValidateNested()
  @Type(() => ExpenseClaimRegisteredFundingDto)
  registeredFunding?: ExpenseClaimRegisteredFundingDto;
}

export class ReverseEmployeeLoanRepaymentDto {
  @IsString({ message: "更正原因必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "更正原因不能超过 500 个字符" })
  reason!: string;

  @IsString({ message: "当前密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" })
  confirmationPassword!: string;
}

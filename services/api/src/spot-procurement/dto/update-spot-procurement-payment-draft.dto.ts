import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  registerDecorator,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS,
  SPOT_PROCUREMENT_PAYMENT_METHODS,
  SPOT_PROCUREMENT_PAYMENT_TYPES,
  type SpotProcurementExpectedInvoiceCondition,
  type SpotProcurementPaymentMethod
} from "@jiangkong/shared-domain";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";
import { IsSpotProcurementQuantity } from "./create-spot-procurement.dto";
import { isSpotProcurementUnitPrice } from "../spot-procurement-money";

const PAYMENT_PATHS = [
  "supplier_direct",
  "handler_reimbursement"
] as const;
export { SPOT_PROCUREMENT_PAYMENT_METHODS };

export type SpotProcurementPaymentPath = (typeof PAYMENT_PATHS)[number];

function IsSpotProcurementUnitPrice(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "spotProcurementUnitPrice",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message:
          "采购单价必须是大于等于 0、最多 2 位小数且可保存的普通十进制字符串"
      },
      validator: { validate: isSpotProcurementUnitPrice }
    });
  };
}

export class SpotProcurementPaymentLineDto {
  @IsOptionalNonBlankText({
    typeMessage: "付款材料明细编号必须是文字",
    blankMessage: "请选择付款材料明细"
  })
  procurementLineId!: string;

  @IsSpotProcurementQuantity()
  paymentQuantity!: string;

  @IsOptionalNonBlankText({
    typeMessage: "含税或无票单价必须是文字",
    blankMessage: "请填写含税或无票单价"
  })
  @IsSpotProcurementUnitPrice()
  unitPrice!: string;

  @IsIn(SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS, {
    message: "预计票据条件不正确"
  })
  expectedInvoiceCondition!: SpotProcurementExpectedInvoiceCondition;

  @ValidateIf(
    (value: SpotProcurementPaymentLineDto) =>
      value.expectedInvoiceCondition !== "no_invoice"
  )
  @IsOptionalNonBlankText({
    typeMessage: "税率选项必须是文字",
    blankMessage: "有票明细必须选择税率"
  })
  vatRateOptionId?: string;
}

export class SpotProcurementPaymentChannelDto {
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, { message: "收款渠道类型不正确" })
  channelType!: SpotProcurementPaymentMethod;

  @IsOptionalNonBlankText({
    typeMessage: "收款账户名称必须是文字",
    blankMessage: "收款账户名称不能为空白"
  })
  accountName?: string | null;

  @IsOptionalNonBlankText({
    typeMessage: "收款账号必须是文字",
    blankMessage: "收款账号不能为空白"
  })
  accountNumber?: string | null;

  @IsOptionalNonBlankText({
    typeMessage: "开户银行必须是文字",
    blankMessage: "开户银行不能为空白"
  })
  bankName?: string | null;

  @IsOptionalNonBlankText({
    typeMessage: "收款渠道备注必须是文字",
    blankMessage: "收款渠道备注不能为空白"
  })
  note?: string | null;

  @IsBoolean({ message: "是否主收款渠道必须是布尔值" })
  isPrimary!: boolean;
}

export class SpotProcurementPaymentAttachmentDto {
  @IsOptionalNonBlankText({
    typeMessage: "付款依据文件编号必须是文字",
    blankMessage: "请选择付款依据文件"
  })
  fileId!: string;

  @IsIn(["merchant_receipt", "merchant_quote", "merchant_invoice", "other"], {
    message: "付款依据类别不正确"
  })
  category!: "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other";
}

export class UpdateSpotProcurementPaymentDraftDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(SPOT_PROCUREMENT_PAYMENT_TYPES, { message: "付款类型不正确" })
  paymentType?: "company_direct" | "handler_reimbursement";

  @IsOptionalNonBlankText({
    typeMessage: "实际商户名称必须是文字",
    blankMessage: "请填写实际商户名称"
  })
  merchantName?: string;

  @IsOptionalNonBlankText({
    typeMessage: "收款对象必须是文字",
    blankMessage: "请填写收款对象"
  })
  payeeName?: string;

  @IsOptionalNonBlankText({
    typeMessage: "商户与收款对象不一致说明必须是文字",
    blankMessage: "商户与收款对象不一致说明不能为空白"
  })
  merchantPayeeMismatchNote?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "付款材料明细必须是数组" })
  @ArrayMinSize(1, { message: "请至少填写一条付款材料明细" })
  @ValidateNested({ each: true, message: "每条付款材料明细必须是对象" })
  @Type(() => SpotProcurementPaymentLineDto)
  paymentLines?: SpotProcurementPaymentLineDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "收款渠道必须是数组" })
  @ArrayMinSize(1, { message: "请至少填写一个收款渠道" })
  @ValidateNested({ each: true, message: "每条收款渠道必须是对象" })
  @Type(() => SpotProcurementPaymentChannelDto)
  channels?: SpotProcurementPaymentChannelDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "拟付款方式必须是数组" })
  @ArrayMinSize(1, { message: "请至少选择一种拟付款方式" })
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, {
    each: true,
    message: "拟付款方式不正确"
  })
  paymentMethods?: SpotProcurementPaymentMethod[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "付款依据必须是数组" })
  @ValidateNested({ each: true, message: "每条付款依据必须是对象" })
  @Type(() => SpotProcurementPaymentAttachmentDto)
  attachments?: SpotProcurementPaymentAttachmentDto[];

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "本次结算金额格式不正确",
    formatMessage: "本次结算金额必须按分填写为 0 或更大的整数"
  })
  settlementAmountCents?: string;

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "供应商余额抵扣金额格式不正确",
    formatMessage: "供应商余额抵扣金额必须按分填写为 0 或更大的整数"
  })
  supplierBalanceAmountCents?: string;

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "公司实际付款申请金额格式不正确",
    formatMessage: "公司实际付款申请金额必须按分填写为 0 或更大的整数"
  })
  companyPaymentAmountCents?: string;

  @IsOptional()
  @IsIn(PAYMENT_PATHS, { message: "付款路径不正确" })
  paymentPath?: SpotProcurementPaymentPath | null;

  @IsOptional()
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, {
    message: "付款方式不正确"
  })
  paymentMethod?: SpotProcurementPaymentMethod | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "收款账户名称必须是文字",
    blankMessage: "收款账户名称不能为空白"
  })
  payeeAccountName?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "开户银行必须是文字",
    blankMessage: "开户银行不能为空白"
  })
  payeeBankName?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "银行账号必须是文字",
    blankMessage: "银行账号不能为空白"
  })
  payeeBankAccount?: string | null;

  @IsOptional()
  @IsDateString({ strict: true }, { message: "预计付款日期格式不正确" })
  expectedPaymentAt?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "付款说明必须是文字",
    blankMessage: "付款说明不能为空白"
  })
  paymentNote?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "支撑附件编号必须是文字",
    blankMessage: "支撑附件编号不能为空白"
  })
  supportingAttachmentFileId?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "商家付款证明编号必须是文字",
    blankMessage: "商家付款证明编号不能为空白"
  })
  merchantPaymentProofFileId?: string | null;
}

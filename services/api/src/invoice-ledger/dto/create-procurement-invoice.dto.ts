import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  registerDecorator,
  ValidateIf,
  ValidateNested,
  type ValidationArguments
} from "class-validator";
import {
  VAT_INVOICE_TYPES,
  type VatInvoiceType
} from "@jiangkong/shared-domain";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

function IsInvoiceIdentityPresent(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "invoiceIdentityPresent",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: "请填写发票代码、发票号码或可识别票据编号"
      },
      validator: {
        validate: (_value: unknown, arguments_: ValidationArguments) => {
          const invoice = arguments_.object as CreateProcurementInvoiceDto;
          return [
            invoice.invoiceCode,
            invoice.invoiceNumber,
            invoice.externalIdentifier
          ].some(
            (value) => typeof value === "string" && value.trim().length > 0
          );
        }
      }
    });
  };
}

export class ProcurementInvoiceAllocationDto {
  @IsRequiredText({
    requiredMessage: "请选择需要分摊的采购明细",
    typeMessage: "采购明细编号必须是文字",
    blankMessage: "采购明细编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "采购明细编号不能超过 128 个字符"
  })
  procurementLineId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "付款单编号必须是文字",
    blankMessage: "付款单编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "付款单编号不能超过 128 个字符"
  })
  paymentId?: string;

  @IsCanonicalMoneyText({
    typeMessage: "发票分摊金额格式不正确",
    formatMessage: "发票分摊金额必须按分填写为 0 或更大的整数",
    rangeMessage: "发票分摊金额超出系统可保存范围"
  })
  amountCents!: string;
}

export class ProcurementInvoiceLineDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "发票明细说明必须是文字",
    blankMessage: "发票明细说明不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "发票明细说明不能超过 500 个字符"
  })
  description?: string;

  @IsRequiredText({
    requiredMessage: "请选择发票明细税率",
    typeMessage: "税率选项编号必须是文字",
    blankMessage: "税率选项编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "税率选项编号不能超过 128 个字符"
  })
  vatRateOptionId!: string;

  @IsCanonicalMoneyText({
    typeMessage: "发票明细价税合计金额格式不正确",
    formatMessage:
      "发票明细价税合计金额必须按分填写为 0 或更大的整数",
    rangeMessage: "发票明细价税合计金额超出系统可保存范围"
  })
  taxInclusiveAmountCents!: string;

  @IsArray({ message: "发票明细分摊必须是数组" })
  @ArrayMinSize(1, {
    message: "每条发票明细至少要填写一条分摊"
  })
  @ValidateNested({ each: true })
  @Type(() => ProcurementInvoiceAllocationDto)
  allocations!: ProcurementInvoiceAllocationDto[];
}

export class CreateProcurementInvoiceDto {
  @IsIn(VAT_INVOICE_TYPES, { message: "发票类型不正确" })
  invoiceType!: VatInvoiceType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "发票代码必须是文字",
    blankMessage: "发票代码不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 100,
    message: "发票代码不能超过 100 个字符"
  })
  invoiceCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "发票号码必须是文字",
    blankMessage: "发票号码不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 100,
    message: "发票号码不能超过 100 个字符"
  })
  invoiceNumber?: string;

  @IsOptionalNonBlankText({
    typeMessage: "可识别票据编号必须是文字",
    blankMessage: "可识别票据编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 200,
    message: "可识别票据编号不能超过 200 个字符"
  })
  @IsInvoiceIdentityPresent()
  externalIdentifier?: string;

  @IsRequiredText({
    requiredMessage: "请填写开票日期",
    typeMessage: "开票日期必须是文字",
    blankMessage: "开票日期不能为空白"
  })
  @IsStrictDateOnly({ message: "开票日期必须为 YYYY-MM-DD 格式的有效日期" })
  issueDate!: string;

  @IsRequiredText({
    requiredMessage: "请填写销售方名称",
    typeMessage: "销售方名称必须是文字",
    blankMessage: "销售方名称不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 200,
    message: "销售方名称不能超过 200 个字符"
  })
  sellerName!: string;

  @IsRequiredText({
    requiredMessage: "请填写购买方名称",
    typeMessage: "购买方名称必须是文字",
    blankMessage: "购买方名称不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 200,
    message: "购买方名称不能超过 200 个字符"
  })
  buyerName!: string;

  @IsCanonicalMoneyText({
    typeMessage: "发票价税合计金额格式不正确",
    formatMessage: "发票价税合计金额必须按分填写为 0 或更大的整数",
    rangeMessage: "发票价税合计金额超出系统可保存范围"
  })
  totalAmountCents!: string;

  @IsRequiredText({
    requiredMessage: "请上传发票文件",
    typeMessage: "发票文件编号必须是文字",
    blankMessage: "发票文件编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "发票文件编号不能超过 128 个字符"
  })
  fileId!: string;

  @IsArray({ message: "发票明细必须是数组" })
  @ArrayMinSize(1, { message: "一张发票至少要填写一条明细" })
  @ValidateNested({ each: true })
  @Type(() => ProcurementInvoiceLineDto)
  lines!: ProcurementInvoiceLineDto[];
}

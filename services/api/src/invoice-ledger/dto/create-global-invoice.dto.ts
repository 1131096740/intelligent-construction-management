import { IsIn, ValidateIf } from "class-validator";
import { VAT_INVOICE_TYPES, type VatInvoiceType } from "@jiangkong/shared-domain";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

export class CreateGlobalInvoiceDto {
  @IsIn(VAT_INVOICE_TYPES, { message: "发票类型不正确" })
  invoiceType!: VatInvoiceType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["digital", "traditional", "other"], { message: "发票身份类型不正确" })
  invoiceIdentityKind?: "digital" | "traditional" | "other";

  @IsRequiredText({ requiredMessage: "请选择发票归属的我方公司主体", typeMessage: "我方公司主体编号必须是文字", blankMessage: "请选择发票归属的我方公司主体" })
  @IsMaxUnicodeTextLength({ max: 128, message: "我方公司主体编号不能超过 128 个字符" })
  owningCompanyEntityId!: string;

  @IsIn(["inbound", "outbound"], { message: "发票方向只能为进项或销项" })
  direction!: "inbound" | "outbound";

  @IsRequiredText({ requiredMessage: "请填写销售方税号", typeMessage: "销售方税号必须是文字", blankMessage: "销售方税号不能为空白" })
  @IsMaxUnicodeTextLength({ max: 64, message: "销售方税号不能超过 64 个字符" })
  sellerTaxId!: string;

  @IsRequiredText({ requiredMessage: "请填写购买方税号", typeMessage: "购买方税号必须是文字", blankMessage: "购买方税号不能为空白" })
  @IsMaxUnicodeTextLength({ max: 64, message: "购买方税号不能超过 64 个字符" })
  buyerTaxId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({ typeMessage: "发票代码必须是文字", blankMessage: "发票代码不能为空白" })
  @IsMaxUnicodeTextLength({ max: 100, message: "发票代码不能超过 100 个字符" })
  invoiceCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({ typeMessage: "发票号码必须是文字", blankMessage: "发票号码不能为空白" })
  @IsMaxUnicodeTextLength({ max: 100, message: "发票号码不能超过 100 个字符" })
  invoiceNumber?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({ typeMessage: "可识别票据编号必须是文字", blankMessage: "可识别票据编号不能为空白" })
  @IsMaxUnicodeTextLength({ max: 200, message: "可识别票据编号不能超过 200 个字符" })
  externalIdentifier?: string;

  @IsRequiredText({ requiredMessage: "请填写开票日期", typeMessage: "开票日期必须是文字", blankMessage: "开票日期不能为空白" })
  @IsStrictDateOnly({ message: "开票日期必须为 YYYY-MM-DD 格式的有效日期" })
  issueDate!: string;

  @IsRequiredText({ requiredMessage: "请填写销售方名称", typeMessage: "销售方名称必须是文字", blankMessage: "销售方名称不能为空白" })
  @IsMaxUnicodeTextLength({ max: 200, message: "销售方名称不能超过 200 个字符" })
  sellerName!: string;

  @IsRequiredText({ requiredMessage: "请填写购买方名称", typeMessage: "购买方名称必须是文字", blankMessage: "购买方名称不能为空白" })
  @IsMaxUnicodeTextLength({ max: 200, message: "购买方名称不能超过 200 个字符" })
  buyerName!: string;

  @IsCanonicalMoneyText({ typeMessage: "发票价税合计金额格式不正确", formatMessage: "发票价税合计金额必须按分填写为 0 或更大的整数", rangeMessage: "发票价税合计金额超出系统可保存范围" })
  totalAmountCents!: string;

  @IsCanonicalMoneyText({ typeMessage: "发票不含税金额格式不正确", formatMessage: "发票不含税金额必须按分填写为 0 或更大的整数", rangeMessage: "发票不含税金额超出系统可保存范围" })
  taxExclusiveAmountCents!: string;

  @IsCanonicalMoneyText({ typeMessage: "发票税额格式不正确", formatMessage: "发票税额必须按分填写为 0 或更大的整数", rangeMessage: "发票税额超出系统可保存范围" })
  taxAmountCents!: string;

  @IsRequiredText({ requiredMessage: "请上传发票文件", typeMessage: "发票文件编号必须是文字", blankMessage: "请上传发票文件" })
  @IsMaxUnicodeTextLength({ max: 128, message: "发票文件编号不能超过 128 个字符" })
  fileId!: string;

  @IsRequiredText({ requiredMessage: "请填写幂等键", typeMessage: "幂等键必须是文字", blankMessage: "请填写幂等键" })
  @IsMaxUnicodeTextLength({ max: 128, message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;
}

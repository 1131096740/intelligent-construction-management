import { ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { IsCanonicalMoneyText, IsMaxUnicodeTextLength, IsRequiredText } from "../../validation/static-field-validation";
import { CreateGlobalInvoiceDto } from "./create-global-invoice.dto";

export class RedInvoiceAllocationReferenceDto {
  @IsRequiredText({ requiredMessage: "请选择蓝字清算发票分配", typeMessage: "蓝字清算发票分配编号必须是文字", blankMessage: "请选择蓝字清算发票分配" })
  @IsMaxUnicodeTextLength({ max: 128, message: "蓝字清算发票分配编号不能超过 128 个字符" })
  blueInvoiceAllocationId!: string;

  @IsCanonicalMoneyText({ typeMessage: "红字引用金额格式不正确", formatMessage: "红字引用金额必须按分填写为 0 或更大的整数", rangeMessage: "红字引用金额超出系统可保存范围" })
  amountCents!: string;
}

export class CreateRedGlobalInvoiceDto extends CreateGlobalInvoiceDto {
  @IsRequiredText({ requiredMessage: "请选择对应蓝字发票", typeMessage: "蓝字发票编号必须是文字", blankMessage: "请选择对应蓝字发票" })
  @IsMaxUnicodeTextLength({ max: 128, message: "蓝字发票编号不能超过 128 个字符" })
  blueInvoiceRecordId!: string;

  @IsRequiredText({ requiredMessage: "请填写红字原因", typeMessage: "红字原因必须是文字", blankMessage: "请填写红字原因" })
  @IsMaxUnicodeTextLength({ max: 100, message: "红字原因不能超过 100 个字符" })
  reasonCode!: string;

  @IsArray({ message: "红字必须逐笔引用蓝字清算发票分配" })
  @ArrayMinSize(1, { message: "红字至少需要引用一笔蓝字清算发票分配" })
  @ValidateNested({ each: true })
  @Type(() => RedInvoiceAllocationReferenceDto)
  blueAllocationReferences!: RedInvoiceAllocationReferenceDto[];
}

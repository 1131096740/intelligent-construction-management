import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreateInvoiceClearingAllocationDto {
  @IsRequiredText({ requiredMessage: "请选择全局发票", typeMessage: "发票编号必须是文字", blankMessage: "请选择全局发票" })
  @IsMaxUnicodeTextLength({ max: 128, message: "发票编号不能超过 128 个字符" })
  invoiceRecordId!: string;

  @IsRequiredText({ requiredMessage: "请选择清算案件", typeMessage: "清算案件编号必须是文字", blankMessage: "请选择清算案件" })
  @IsMaxUnicodeTextLength({ max: 128, message: "清算案件编号不能超过 128 个字符" })
  clearingCaseId!: string;

  @IsRequiredText({ requiredMessage: "请选择已确认清算版本", typeMessage: "清算版本编号必须是文字", blankMessage: "请选择已确认清算版本" })
  @IsMaxUnicodeTextLength({ max: 128, message: "清算版本编号不能超过 128 个字符" })
  clearingEventVersionId!: string;

  @IsCanonicalMoneyText({ typeMessage: "发票清算分配金额格式不正确", formatMessage: "发票清算分配金额必须按分填写为 0 或更大的整数", rangeMessage: "发票清算分配金额超出系统可保存范围" })
  amountCents!: string;

  @IsOptionalNonBlankText({ typeMessage: "结构化原因必须是文字", blankMessage: "结构化原因不能为空白" })
  @IsMaxUnicodeTextLength({ max: 100, message: "结构化原因不能超过 100 个字符" })
  structuredReasonCode?: string;

  @IsRequiredText({ requiredMessage: "请填写幂等键", typeMessage: "幂等键必须是文字", blankMessage: "请填写幂等键" })
  @IsMaxUnicodeTextLength({ max: 128, message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;

}

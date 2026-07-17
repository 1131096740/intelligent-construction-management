import { ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreateInvoiceExceptionConfirmationDto {
  @IsRequiredText({
    requiredMessage: "请选择票据异常对应的采购明细",
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

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "发票明细编号必须是文字",
    blankMessage: "发票明细编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "发票明细编号不能超过 128 个字符"
  })
  invoiceLineId?: string;

  @IsCanonicalMoneyText({
    typeMessage: "票据异常金额格式不正确",
    formatMessage: "票据异常金额必须按分填写为 0 或更大的整数",
    rangeMessage: "票据异常金额超出系统可保存范围"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "票据异常必须填写原因",
    typeMessage: "票据异常原因必须是文字",
    blankMessage: "票据异常原因不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "票据异常原因不能超过 500 个字符"
  })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "票据异常必须上传证明",
    typeMessage: "票据异常证明文件编号必须是文字",
    blankMessage: "票据异常证明文件编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "票据异常证明文件编号不能超过 128 个字符"
  })
  proofFileId!: string;
}

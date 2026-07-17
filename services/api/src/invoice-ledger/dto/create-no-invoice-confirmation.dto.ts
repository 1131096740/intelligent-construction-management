import { ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreateNoInvoiceConfirmationDto {
  @IsRequiredText({
    requiredMessage: "请选择无票确认对应的采购明细",
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
    typeMessage: "无票确认金额格式不正确",
    formatMessage: "无票确认金额必须按分填写为 0 或更大的整数",
    rangeMessage: "无票确认金额超出系统可保存范围"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "无票确认必须填写原因",
    typeMessage: "无票原因必须是文字",
    blankMessage: "无票原因不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "无票原因不能超过 500 个字符"
  })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "无票确认必须上传替代证明",
    typeMessage: "替代证明文件编号必须是文字",
    blankMessage: "替代证明文件编号不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 128,
    message: "替代证明文件编号不能超过 128 个字符"
  })
  proofFileId!: string;
}

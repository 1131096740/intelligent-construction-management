import { Equals, IsBoolean } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ReverseInvoiceAllocationDto {
  @IsRequiredText({
    requiredMessage: "解除发票分摊必须填写原因",
    typeMessage: "解除发票分摊原因必须是文字",
    blankMessage: "解除发票分摊原因不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "解除发票分摊原因不能超过 500 个字符"
  })
  reason!: string;

  @IsBoolean({ message: "解除发票分摊确认值必须是布尔值" })
  @Equals(true, { message: "请明确确认解除本次发票分摊" })
  confirmReversal!: boolean;
}

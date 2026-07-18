import { IsRequiredText } from "../../validation/static-field-validation";

export class InvalidateSpotPaymentInvoiceDto {
  @IsRequiredText({
    requiredMessage: "请填写发票附件作废原因",
    typeMessage: "发票附件作废原因必须是文字",
    blankMessage: "发票附件作废原因不能为空白"
  })
  reason!: string;
}

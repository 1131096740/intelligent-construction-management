import { IsRequiredText } from "../../validation/static-field-validation";

export class AttachSpotPaymentInvoiceDto {
  @IsRequiredText({
    requiredMessage: "请选择发票文件",
    typeMessage: "发票文件标识必须是文字",
    blankMessage: "发票文件标识不能为空白"
  })
  fileId!: string;
}

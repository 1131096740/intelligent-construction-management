import { CreateGlobalInvoiceDto } from "./create-global-invoice.dto";
import { IsMaxUnicodeTextLength, IsRequiredText } from "../../validation/static-field-validation";

export class CreateReissueGlobalInvoiceDto extends CreateGlobalInvoiceDto {
  @IsRequiredText({ requiredMessage: "请选择需要重开的原发票", typeMessage: "原发票编号必须是文字", blankMessage: "请选择需要重开的原发票" })
  @IsMaxUnicodeTextLength({ max: 128, message: "原发票编号不能超过 128 个字符" })
  originalInvoiceRecordId!: string;

  @IsRequiredText({ requiredMessage: "请填写重开原因", typeMessage: "重开原因必须是文字", blankMessage: "重开原因不能为空白" })
  @IsMaxUnicodeTextLength({ max: 100, message: "重开原因不能超过 100 个字符" })
  reasonCode!: string;
}

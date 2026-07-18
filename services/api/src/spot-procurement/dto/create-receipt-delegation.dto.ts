import { IsRequiredText } from "../../validation/static-field-validation";

export class CreateReceiptDelegationDto {
  @IsRequiredText({
    requiredMessage: "请选择收货受托人",
    typeMessage: "收货受托人编号必须是文字",
    blankMessage: "请选择收货受托人"
  })
  delegateUserId!: string;
}

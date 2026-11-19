import { IsUUID } from "class-validator";
export class AttachRegisteredPaymentVoucherDto {
  @IsUUID("4", {message:"请选择有效的私有付款凭证"}) fileId!: string;
}

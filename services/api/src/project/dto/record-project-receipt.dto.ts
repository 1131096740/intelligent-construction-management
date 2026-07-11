import { IsDateString, IsIn, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export type ProjectReceiptSourceType =
  | "general_contractor_payment"
  | "owner_direct_payment"
  | "other";

export class RecordProjectReceiptDto {
  @IsDateString({ strict: true }, { message: "到账日期格式不正确" })
  receivedAt!: string;

  @IsString({ message: "到账金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "到账金额必须按分填写为 0 或更大的整数" })
  amountCents!: string;

  @IsString({ message: "付款方名称必须是文字" })
  @IsNotEmpty({ message: "付款方名称不能为空" })
  @Matches(/\S/u, { message: "付款方名称不能为空白" })
  payerName!: string;

  @IsIn(["general_contractor_payment", "owner_direct_payment", "other"], {
    message: "到账来源类型不正确"
  })
  sourceType!: ProjectReceiptSourceType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "到账说明必须是文字" })
  description?: string;

  @IsString({ message: "到账凭证编号必须是文字" })
  @IsNotEmpty({ message: "到账凭证不能为空" })
  @Matches(/\S/u, { message: "到账凭证不能为空白" })
  voucherFileId!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}

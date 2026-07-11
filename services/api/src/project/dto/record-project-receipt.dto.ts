import { IsDateString, IsIn, IsString, ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export type ProjectReceiptSourceType =
  | "general_contractor_payment"
  | "owner_direct_payment"
  | "other";

export class RecordProjectReceiptDto {
  @IsDateString({ strict: true }, { message: "到账日期格式不正确" })
  receivedAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "到账金额格式不正确",
    formatMessage: "到账金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "付款方名称不能为空",
    typeMessage: "付款方名称必须是文字",
    blankMessage: "付款方名称不能为空白"
  })
  payerName!: string;

  @IsIn(["general_contractor_payment", "owner_direct_payment", "other"], {
    message: "到账来源类型不正确"
  })
  sourceType!: ProjectReceiptSourceType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "到账说明必须是文字" })
  description?: string;

  @IsRequiredText({
    requiredMessage: "到账凭证不能为空",
    typeMessage: "到账凭证编号必须是文字",
    blankMessage: "到账凭证不能为空白"
  })
  voucherFileId!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;
}

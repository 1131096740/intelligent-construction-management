import { IsDateString, IsIn, IsOptional } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";

const PAYMENT_PATHS = [
  "supplier_direct",
  "handler_reimbursement"
] as const;
export const SPOT_PROCUREMENT_PAYMENT_METHODS = [
  "cash",
  "wechat",
  "alipay",
  "bank_transfer",
  "other"
] as const;

export type SpotProcurementPaymentPath = (typeof PAYMENT_PATHS)[number];

export class UpdateSpotProcurementPaymentDraftDto {
  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "本次结算金额格式不正确",
    formatMessage: "本次结算金额必须按分填写为 0 或更大的整数"
  })
  settlementAmountCents?: string;

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "供应商余额抵扣金额格式不正确",
    formatMessage: "供应商余额抵扣金额必须按分填写为 0 或更大的整数"
  })
  supplierBalanceAmountCents?: string;

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "公司实际付款申请金额格式不正确",
    formatMessage: "公司实际付款申请金额必须按分填写为 0 或更大的整数"
  })
  companyPaymentAmountCents?: string;

  @IsOptional()
  @IsIn(PAYMENT_PATHS, { message: "付款路径不正确" })
  paymentPath?: SpotProcurementPaymentPath | null;

  @IsOptional()
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, {
    message: "付款方式不正确"
  })
  paymentMethod?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "收款账户名称必须是文字",
    blankMessage: "收款账户名称不能为空白"
  })
  payeeAccountName?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "开户银行必须是文字",
    blankMessage: "开户银行不能为空白"
  })
  payeeBankName?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "银行账号必须是文字",
    blankMessage: "银行账号不能为空白"
  })
  payeeBankAccount?: string | null;

  @IsOptional()
  @IsDateString({ strict: true }, { message: "预计付款日期格式不正确" })
  expectedPaymentAt?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "付款说明必须是文字",
    blankMessage: "付款说明不能为空白"
  })
  paymentNote?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "支撑附件编号必须是文字",
    blankMessage: "支撑附件编号不能为空白"
  })
  supportingAttachmentFileId?: string | null;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "商家付款证明编号必须是文字",
    blankMessage: "商家付款证明编号不能为空白"
  })
  merchantPaymentProofFileId?: string | null;
}

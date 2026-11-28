import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf
} from "class-validator";
import { IsCanonicalMoneyText, IsRequiredText } from "../../validation/static-field-validation";
import { CONSTRUCTION_PAYMENT_CORRECTION_SOURCES } from "../project-construction-payment-correction.service";

export class RequestConstructionPaymentCorrectionDto {
  @IsIn(CONSTRUCTION_PAYMENT_CORRECTION_SOURCES, {
    message: "施工企业付款更正来源类型不正确"
  })
  sourceType!: (typeof CONSTRUCTION_PAYMENT_CORRECTION_SOURCES)[number];

  @IsRequiredText({
    requiredMessage: "请选择需要更正的施工企业付款事实",
    typeMessage: "待更正事实编号必须是文字",
    blankMessage: "请选择需要更正的施工企业付款事实"
  })
  originalFactId!: string;

  @IsRequiredText({
    requiredMessage: "请填写更正原因",
    typeMessage: "更正原因必须是文字",
    blankMessage: "请填写更正原因"
  })
  correctionReason!: string;

  @IsUUID("4", { message: "施工企业付款更正幂等键必须是 UUID" })
  idempotencyKey!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "更正后的金额格式不正确",
    formatMessage: "更正后的金额必须按分填写为大于零的整数"
  })
  amountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString({ strict: true }, { message: "更正后的业务日期格式不正确" })
  occurredAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的对象名称必须是文字" })
  counterpartyName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的费用名称必须是文字" })
  feeName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的施工企业合同编号必须是文字" })
  contractLedgerId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的施工企业结算编号必须是文字" })
  settlementLedgerId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的付款申请业务单号必须是文字" })
  paymentRequestId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的我方公司编号必须是文字" })
  companyEntityId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的我方合同编号必须是文字" })
  affiliateCompanyContractId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的施工企业结算事实编号必须是文字" })
  affiliateSettlementFactId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的发票编号必须是文字" })
  invoiceRecordId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正后的依据文件编号必须是文字" })
  evidenceFileId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "更正说明必须是文字" })
  description?: string;
}

export class ConfirmConstructionPaymentCorrectionDto {
  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;

  @IsRequiredText({
    requiredMessage: "请提供施工企业付款更正确认幂等键",
    typeMessage: "确认幂等键必须是文字",
    blankMessage: "请提供施工企业付款更正确认幂等键"
  })
  confirmationActionId!: string;

  @IsOptional()
  @IsString({ message: "自审原因必须是文字" })
  selfReviewReason?: string;
}

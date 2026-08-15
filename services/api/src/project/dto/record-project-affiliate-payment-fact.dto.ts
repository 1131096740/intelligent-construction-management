import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";
import {
  PROJECT_AFFILIATE_BASIS_TYPES,
  PROJECT_AFFILIATE_ENTRY_KINDS,
  type ProjectAffiliateBasisType,
  type ProjectAffiliateEntryKind
} from "./record-project-affiliate-contract-fact.dto";

export const PROJECT_AFFILIATE_PAYMENT_KINDS = [
  "normal",
  "advance",
  "direct_contract"
] as const;
export type ProjectAffiliatePaymentKind =
  (typeof PROJECT_AFFILIATE_PAYMENT_KINDS)[number];

export class RecordProjectAffiliatePaymentFactDto {
  @IsRequiredText({
    requiredMessage: "关联施工企业合同账本编号不能为空",
    typeMessage: "关联施工企业合同账本编号必须是文字",
    blankMessage: "关联施工企业合同账本编号不能为空白"
  })
  contractLedgerId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "关联施工企业结算账本编号必须是文字" })
  settlementLedgerId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "已审批付款申请编号必须是文字" })
  paymentRequestId?: string;

  @IsRequiredText({
    requiredMessage: "付款相对方不能为空",
    typeMessage: "付款相对方必须是文字",
    blankMessage: "付款相对方不能为空白"
  })
  counterpartyName!: string;

  @IsDateString({ strict: true }, { message: "外部付款日期格式不正确" })
  paidAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "外部付款金额格式不正确",
    formatMessage: "外部付款金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsIn(PROJECT_AFFILIATE_PAYMENT_KINDS, { message: "施工企业付款类型不正确" })
  paymentKind!: ProjectAffiliatePaymentKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "外部付款唯一流水号必须是文字" })
  externalPaymentReference?: string;

  @IsIn(PROJECT_AFFILIATE_BASIS_TYPES, { message: "外部付款依据类型不正确" })
  basisType!: ProjectAffiliateBasisType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "外部付款依据文件编号必须是文字" })
  evidenceFileId?: string;

  @IsUUID("4", { message: "施工企业付款登记幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(PROJECT_AFFILIATE_ENTRY_KINDS, { message: "施工企业付款追加类型不正确" })
  entryKind?: ProjectAffiliateEntryKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "被调整施工企业付款事实编号必须是文字" })
  adjustsFactId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["increase", "decrease"], { message: "施工企业付款金额调整方向不正确" })
  effectDirection?: "increase" | "decrease";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业付款说明必须是文字" })
  description?: string;
}

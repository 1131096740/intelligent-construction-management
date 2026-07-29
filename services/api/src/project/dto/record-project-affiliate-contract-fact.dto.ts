import {
  IsBoolean,
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

export const PROJECT_AFFILIATE_CONTRACT_TYPES = [
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract",
  "general_settlement",
  "general_direct_payment"
] as const;
export type ProjectAffiliateContractType =
  (typeof PROJECT_AFFILIATE_CONTRACT_TYPES)[number];

export const PROJECT_AFFILIATE_BASIS_TYPES = ["written", "oral"] as const;
export type ProjectAffiliateBasisType =
  (typeof PROJECT_AFFILIATE_BASIS_TYPES)[number];

export const PROJECT_AFFILIATE_ENTRY_KINDS = [
  "original",
  "correction",
  "reversal"
] as const;
export type ProjectAffiliateEntryKind =
  (typeof PROJECT_AFFILIATE_ENTRY_KINDS)[number];

export const PROJECT_AFFILIATE_AMOUNT_NATURES = ["fixed", "uncapped"] as const;
export type ProjectAffiliateAmountNature =
  (typeof PROJECT_AFFILIATE_AMOUNT_NATURES)[number];

export class RecordProjectAffiliateContractFactDto {
  @IsIn(PROJECT_AFFILIATE_CONTRACT_TYPES, { message: "挂靠对下合同类型不正确" })
  contractType!: ProjectAffiliateContractType;

  @IsRequiredText({
    requiredMessage: "外部合同编号不能为空",
    typeMessage: "外部合同编号必须是文字",
    blankMessage: "外部合同编号不能为空白"
  })
  externalContractReference!: string;

  @IsRequiredText({
    requiredMessage: "合同相对方不能为空",
    typeMessage: "合同相对方必须是文字",
    blankMessage: "合同相对方不能为空白"
  })
  counterpartyName!: string;

  @IsDateString({ strict: true }, { message: "外部合同签订日期格式不正确" })
  signedAt!: string;

  @IsIn(PROJECT_AFFILIATE_AMOUNT_NATURES, { message: "合同金额性质不正确" })
  amountNature!: ProjectAffiliateAmountNature;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "合同金额格式不正确",
    formatMessage: "合同金额必须按分填写为 0 或更大的整数"
  })
  amountCents?: string;

  @IsIn(PROJECT_AFFILIATE_BASIS_TYPES, { message: "外部合同依据类型不正确" })
  basisType!: ProjectAffiliateBasisType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "外部合同依据文件编号必须是文字" })
  evidenceFileId?: string;

  @IsBoolean({ message: "预付款约定标记必须是布尔值" })
  advanceAllowed!: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "预付款上限格式不正确",
    formatMessage: "预付款上限必须按分填写为 0 或更大的整数"
  })
  advanceLimitCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "预付款约定摘要必须是文字" })
  advanceTermsSummary?: string;

  @IsUUID("4", { message: "挂靠合同登记幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(PROJECT_AFFILIATE_ENTRY_KINDS, { message: "挂靠合同追加类型不正确" })
  entryKind?: ProjectAffiliateEntryKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "被调整挂靠合同事实编号必须是文字" })
  adjustsFactId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["increase", "decrease"], { message: "挂靠合同金额调整方向不正确" })
  effectDirection?: "increase" | "decrease";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "挂靠合同说明必须是文字" })
  description?: string;
}

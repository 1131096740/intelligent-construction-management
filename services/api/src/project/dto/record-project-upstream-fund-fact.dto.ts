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

export const PROJECT_UPSTREAM_FUND_FACT_TYPES = [
  "owner_payment_to_affiliate",
  "affiliate_remittance_to_company",
  "affiliate_deduction",
  "unreconciled_receipt_difference"
] as const;
export type ProjectUpstreamFundFactType =
  (typeof PROJECT_UPSTREAM_FUND_FACT_TYPES)[number];

export const PROJECT_UPSTREAM_FUND_BASIS_TYPES = ["written", "oral"] as const;
export type ProjectUpstreamFundBasisType =
  (typeof PROJECT_UPSTREAM_FUND_BASIS_TYPES)[number];

export const PROJECT_UPSTREAM_FUND_ENTRY_KINDS = [
  "original",
  "correction",
  "reversal",
  "reclassification"
] as const;
export type ProjectUpstreamFundEntryKind =
  (typeof PROJECT_UPSTREAM_FUND_ENTRY_KINDS)[number];

export const PROJECT_AFFILIATE_DEDUCTION_CATEGORIES = [
  "management_fee",
  "tax",
  "deposit",
  "insurance",
  "other"
] as const;
export type ProjectAffiliateDeductionCategory =
  (typeof PROJECT_AFFILIATE_DEDUCTION_CATEGORIES)[number];

export class RecordProjectUpstreamFundFactDto {
  @IsIn(PROJECT_UPSTREAM_FUND_FACT_TYPES, { message: "上游资金事实类型不正确" })
  factType!: ProjectUpstreamFundFactType;

  @IsIn(PROJECT_UPSTREAM_FUND_BASIS_TYPES, { message: "上游资金依据类型不正确" })
  basisType!: ProjectUpstreamFundBasisType;

  @IsDateString({ strict: true }, { message: "上游资金发生日期格式不正确" })
  occurredAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "上游资金金额格式不正确",
    formatMessage: "上游资金金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "交易对方名称不能为空",
    typeMessage: "交易对方名称必须是文字",
    blankMessage: "交易对方名称不能为空白"
  })
  counterpartyName!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(PROJECT_AFFILIATE_DEDUCTION_CATEGORIES, { message: "挂靠扣款类型不正确" })
  deductionCategory?: ProjectAffiliateDeductionCategory;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "关联上游结算编号必须是文字" })
  upstreamSettlementId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "依据文件编号必须是文字" })
  evidenceFileId?: string;

  @IsUUID("4", { message: "上游资金登记幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(PROJECT_UPSTREAM_FUND_ENTRY_KINDS, { message: "上游资金追加类型不正确" })
  entryKind?: ProjectUpstreamFundEntryKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "被调整资金事实编号必须是文字" })
  adjustsFactId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["increase", "decrease"], { message: "上游资金调整方向不正确" })
  effectDirection?: "increase" | "decrease";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "上游资金说明必须是文字" })
  description?: string;
}

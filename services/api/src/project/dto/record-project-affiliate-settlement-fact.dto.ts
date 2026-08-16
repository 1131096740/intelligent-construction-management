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

export class RecordProjectAffiliateSettlementFactDto {
  @IsRequiredText({
    requiredMessage: "关联施工企业合同账本编号不能为空",
    typeMessage: "关联施工企业合同账本编号必须是文字",
    blankMessage: "关联施工企业合同账本编号不能为空白"
  })
  contractLedgerId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业—我方合同档案编号必须是文字" })
  affiliateCompanyContractId?: string;

  @IsRequiredText({
    requiredMessage: "结算相对方不能为空",
    typeMessage: "结算相对方必须是文字",
    blankMessage: "结算相对方不能为空白"
  })
  counterpartyName!: string;

  @IsDateString({ strict: true }, { message: "外部结算日期格式不正确" })
  settledAt!: string;

  @IsRequiredText({
    requiredMessage: "外部结算期间不能为空",
    typeMessage: "外部结算期间必须是文字",
    blankMessage: "外部结算期间不能为空白"
  })
  periodLabel!: string;

  @IsCanonicalMoneyText({
    typeMessage: "外部结算金额格式不正确",
    formatMessage: "外部结算金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsIn(PROJECT_AFFILIATE_BASIS_TYPES, { message: "外部结算依据类型不正确" })
  basisType!: ProjectAffiliateBasisType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "外部结算依据文件编号必须是文字" })
  evidenceFileId?: string;

  @IsUUID("4", { message: "施工企业结算登记幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(PROJECT_AFFILIATE_ENTRY_KINDS, { message: "施工企业结算追加类型不正确" })
  entryKind?: ProjectAffiliateEntryKind;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "被调整施工企业结算事实编号必须是文字" })
  adjustsFactId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["increase", "decrease"], { message: "施工企业结算金额调整方向不正确" })
  effectDirection?: "increase" | "decrease";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业结算说明必须是文字" })
  description?: string;
}

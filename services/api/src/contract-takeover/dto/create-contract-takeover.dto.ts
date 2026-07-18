import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateIf,
  ValidateNested
} from "class-validator";
import type {
  ContractInvoiceType,
  ContractTaxFactSource,
  ContractTaxMode
} from "@jiangkong/shared-domain";
import {
  IsCanonicalMoneyText,
  IsIntegerInRange,
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

export type ContractTakeoverLevel = "A" | "B" | "C";

export type ContractLifecycleStatus =
  | "signed_not_started"
  | "in_progress"
  | "suspended"
  | "completed"
  | "terminated"
  | "disputed";

export class HistoricalTakeoverDirectPaymentStageDto {
  @IsRequiredText({
    requiredMessage: "请填写付款阶段名称",
    typeMessage: "付款阶段名称必须是文字",
    blankMessage: "请填写付款阶段名称"
  })
  name!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 1,
    max: 10_000,
    typeMessage: "付款比例必须是整数",
    rangeMessage: "付款比例必须在 1 到 10000 之间"
  })
  ratioBps?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "固定付款金额格式不正确",
    formatMessage: "固定付款金额必须按分填写为正整数"
  })
  fixedAmountCents?: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "付款期限必须是整数天",
    rangeMessage: "付款期限必须在 0 到 2147483647 天之间"
  })
  dueDays!: number;

  @IsBoolean({ message: "是否要求发票必须是布尔值" })
  requiresInvoice!: boolean;

  @IsBoolean({ message: "是否允许提前付款必须是布尔值" })
  allowsEarlyPayment!: boolean;

  @IsBoolean({ message: "是否允许分次付款必须是布尔值" })
  allowsInstallments!: boolean;
}

export class HistoricalPricingItemDto {
  @IsRequiredText({
    requiredMessage: "请填写清单标识",
    typeMessage: "清单标识必须是文字",
    blankMessage: "请填写清单标识"
  })
  billKey!: string;

  @IsRequiredText({
    requiredMessage: "请填写清单名称",
    typeMessage: "清单名称必须是文字",
    blankMessage: "请填写清单名称"
  })
  billName!: string;

  @IsRequiredText({
    requiredMessage: "请填写项目标识",
    typeMessage: "项目标识必须是文字",
    blankMessage: "请填写项目标识"
  })
  rowKey!: string;

  @IsOptionalNonBlankText({
    typeMessage: "项目编码必须是文字",
    blankMessage: "项目编码不能为空白"
  })
  itemCode?: string;

  @IsRequiredText({
    requiredMessage: "请填写项目名称",
    typeMessage: "项目名称必须是文字",
    blankMessage: "请填写项目名称"
  })
  itemName!: string;

  @IsOptionalNonBlankText({
    typeMessage: "规格型号必须是文字",
    blankMessage: "规格型号不能为空白"
  })
  specification?: string;

  @IsRequiredText({
    requiredMessage: "请填写计量单位",
    typeMessage: "计量单位必须是文字",
    blankMessage: "请填写计量单位"
  })
  unit!: string;

  @IsOptionalNonBlankText({
    typeMessage: "预计数量必须是文字",
    blankMessage: "预计数量不能为空白"
  })
  estimatedQuantity?: string;

  @IsOptionalNonBlankText({
    typeMessage: "含税单价必须是文字",
    blankMessage: "含税单价不能为空白"
  })
  taxInclusiveUnitPrice?: string;

  @IsOptionalNonBlankText({
    typeMessage: "例外税率必须是文字",
    blankMessage: "例外税率不能为空白"
  })
  taxRatePercentOverride?: string;

  @IsOptional()
  @IsBoolean({ message: "暂定项标记必须是布尔值" })
  isProvisional?: boolean;

  @IsOptionalNonBlankText({
    typeMessage: "结算依据必须是文字",
    blankMessage: "结算依据不能为空白"
  })
  settlementBasis?: string;
}

export class CreateContractTakeoverDto {
  @IsRequiredText({
    requiredMessage: "请填写合同编号",
    typeMessage: "合同编号必须是文字",
    blankMessage: "请填写合同编号"
  })
  code!: string;

  @IsRequiredText({
    requiredMessage: "请填写合同名称",
    typeMessage: "合同名称必须是文字",
    blankMessage: "请填写合同名称"
  })
  name!: string;

  @IsRequiredText({
    requiredMessage: "请填写相对方",
    typeMessage: "相对方必须是文字",
    blankMessage: "请填写相对方"
  })
  counterparty!: string;

  @IsOptionalNonBlankText({
    typeMessage: "合同类型必须是文字",
    blankMessage: "合同类型不能为空白"
  })
  contractTypeKey?: string;

  @IsOptionalNonBlankText({
    typeMessage: "签约主体编号必须是文字",
    blankMessage: "签约主体编号不能为空白"
  })
  companyEntityId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "签约主体名称必须是文字",
    blankMessage: "签约主体名称不能为空白"
  })
  companyEntityName?: string;

  @IsOptional()
  @IsIn(["vat_general", "vat_special"], {
    message: "发票类型请选择增值税普通发票或增值税专用发票"
  })
  invoiceType?: ContractInvoiceType;

  @IsOptional()
  @IsIn(["single_rate", "multiple_rate"], {
    message: "计税模式请选择单一税率或特殊多税率"
  })
  taxMode?: ContractTaxMode;

  @IsOptionalNonBlankText({
    typeMessage: "默认税率必须是文字",
    blankMessage: "默认税率不能为空白"
  })
  defaultTaxRatePercent?: string;

  @IsOptional()
  @IsIn(
    ["contract_document", "supplement_evidence", "business_finance_confirmation"],
    { message: "税务事实来源不在系统支持范围内" }
  )
  taxFactSource?: ContractTaxFactSource;

  @IsOptionalNonBlankText({
    typeMessage: "税务事实确认说明必须是文字",
    blankMessage: "税务事实确认说明不能为空白"
  })
  taxFactExplanation?: string;

  @IsOptionalNonBlankText({
    typeMessage: "税务事实依据文件标识必须是文字",
    blankMessage: "税务事实依据文件标识不能为空白"
  })
  taxFactEvidenceFileId?: string;

  @IsOptional()
  @IsArray({ message: "历史计价清单必须是数组" })
  @ArrayMaxSize(2000, { message: "单份历史合同最多导入 2000 条计价项目" })
  @ValidateNested({ each: true, message: "每条历史计价项目必须是对象" })
  @Type(() => HistoricalPricingItemDto)
  pricingItems?: HistoricalPricingItemDto[];

  @IsCanonicalMoneyText({
    typeMessage: "合同金额格式不正确",
    formatMessage: "合同金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "请按 YYYY-MM-DD 填写签订日期",
    typeMessage: "签订日期必须是文字",
    blankMessage: "请按 YYYY-MM-DD 填写签订日期"
  })
  @IsStrictDateOnly({ message: "签订日期必须按 YYYY-MM-DD 填写且日期必须有效" })
  signedAt!: string;

  @IsIn(["A", "B", "C"], { message: "接管等级请选择 A级、B级或C级" })
  takeoverLevel!: ContractTakeoverLevel;

  @IsIn(
    ["signed_not_started", "in_progress", "suspended", "completed", "terminated", "disputed"],
    { message: "履约状态不在系统支持范围内" }
  )
  lifecycleStatus!: ContractLifecycleStatus;

  @IsOptionalNonBlankText({
    typeMessage: "付款条款原文摘要必须是文字",
    blankMessage: "付款条款原文摘要不能为空白"
  })
  paymentTermsOriginalText?: string;

  @IsOptional()
  @IsArray({ message: "直接付款阶段必须是列表" })
  @ArrayMaxSize(20, { message: "直接付款阶段最多填写 20 项" })
  @ValidateNested({ each: true })
  @Type(() => HistoricalTakeoverDirectPaymentStageDto)
  paymentStages?: HistoricalTakeoverDirectPaymentStageDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史累计结算格式不正确",
    formatMessage: "历史累计结算必须按分填写为 0 或更大的整数"
  })
  historicalSettledCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史审批中付款格式不正确",
    formatMessage: "历史审批中付款必须按分填写为 0 或更大的整数"
  })
  historicalApprovalPendingPaymentCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史已批待付格式不正确",
    formatMessage: "历史已批待付必须按分填写为 0 或更大的整数"
  })
  historicalApprovedPendingPaymentCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史累计已付格式不正确",
    formatMessage: "历史累计已付必须按分填写为 0 或更大的整数"
  })
  historicalPaidCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史总包代付格式不正确",
    formatMessage: "历史总包代付必须按分填写为 0 或更大的整数"
  })
  historicalProxyPaidCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史预付款已付格式不正确",
    formatMessage: "历史预付款已付必须按分填写为 0 或更大的整数"
  })
  historicalAdvancePaidCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史预付款已扣回格式不正确",
    formatMessage: "历史预付款已扣回必须按分填写为 0 或更大的整数"
  })
  historicalAdvanceDeductedCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史质保金扣留格式不正确",
    formatMessage: "历史质保金扣留必须按分填写为 0 或更大的整数"
  })
  historicalRetentionWithheldCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "历史质保金释放格式不正确",
    formatMessage: "历史质保金释放必须按分填写为 0 或更大的整数"
  })
  historicalRetentionReleasedCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "其他确认占用格式不正确",
    formatMessage: "其他确认占用必须按分填写为 0 或更大的整数"
  })
  otherConfirmedOccupancyCents?: string;

  @IsOptionalNonBlankText({
    typeMessage: "余额来源说明必须是文字",
    blankMessage: "余额来源说明不能为空白"
  })
  balanceSourceSummary?: string;

  @IsOptionalNonBlankText({
    typeMessage: "证据说明必须是文字",
    blankMessage: "证据说明不能为空白"
  })
  evidenceSummary?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管截止日必须是文字",
    blankMessage: "接管截止日不能为空白"
  })
  @IsStrictDateOnly({ message: "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效" })
  takeoverCutoffDate?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管责任人编号必须是文字",
    blankMessage: "接管责任人编号不能为空白"
  })
  responsibleUserId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管等级调整说明必须是文字",
    blankMessage: "接管等级调整说明不能为空白"
  })
  takeoverLevelAdjustmentReason?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管复核意见必须是文字",
    blankMessage: "接管复核意见不能为空白"
  })
  reviewComment?: string;

  @IsOptionalNonBlankText({
    typeMessage: "接管验收结论必须是文字",
    blankMessage: "接管验收结论不能为空白"
  })
  acceptanceConclusion?: string;
}

export class UpdateContractTakeoverDto extends CreateContractTakeoverDto {}

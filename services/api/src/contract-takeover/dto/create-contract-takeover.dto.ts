import { IsIn, IsString, ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
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

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "接管截止日必须是文字" })
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

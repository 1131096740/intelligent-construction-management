import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsIntegerInRange,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";
import { HistoricalTakeoverDirectPaymentStageDto } from "./create-contract-takeover.dto";

export type ContractTakeoverPerformanceStatus =
  | "not_started"
  | "performing"
  | "suspended"
  | "completed"
  | "terminated";

export class HistoricalPaymentTermsInput {
  @IsRequiredText({
    requiredMessage: "请填写历史付款条款原文",
    typeMessage: "历史付款条款原文必须是文字",
    blankMessage: "请填写历史付款条款原文"
  })
  originalText!: string;

  @IsArray({ message: "历史付款阶段必须是数组" })
  @ArrayMaxSize(50, { message: "历史付款阶段最多填写 50 项" })
  @ValidateNested({ each: true, message: "每个历史付款阶段必须是对象" })
  @Type(() => HistoricalTakeoverDirectPaymentStageDto)
  stages!: HistoricalTakeoverDirectPaymentStageDto[];
}

export class HistoricalContractFactsInput {
  @IsRequiredText({
    requiredMessage: "请填写历史合同编号",
    typeMessage: "历史合同编号必须是文字",
    blankMessage: "请填写历史合同编号"
  })
  contractNo!: string;

  @IsRequiredText({
    requiredMessage: "请填写历史合同名称",
    typeMessage: "历史合同名称必须是文字",
    blankMessage: "请填写历史合同名称"
  })
  contractName!: string;

  @IsRequiredText({
    requiredMessage: "请选择历史合同类型",
    typeMessage: "历史合同类型必须是文字",
    blankMessage: "请选择历史合同类型"
  })
  contractTypeKey!: string;

  @IsRequiredText({
    requiredMessage: "请填写历史合同相对方",
    typeMessage: "历史合同相对方必须是文字",
    blankMessage: "请填写历史合同相对方"
  })
  counterparty!: string;

  @IsCanonicalMoneyText({
    typeMessage: "历史合同原始金额格式不正确",
    formatMessage: "历史合同原始金额必须按分填写为 0 或更大的整数"
  })
  originalAmountCents!: string;

  @IsOptional()
  @IsStrictDateOnly({
    message: "历史结算截止日必须按 YYYY-MM-DD 填写且日期必须有效"
  })
  settlementCutoffDate?: string;

  @IsBoolean({ message: "历史累计结算为零声明必须是布尔值" })
  zeroSettlementDeclared!: boolean;

  @ValidateIf((facts: HistoricalContractFactsInput) => facts.zeroSettlementDeclared)
  @IsRequiredText({
    requiredMessage: "历史累计结算为零时必须填写依据",
    typeMessage: "历史累计结算为零依据必须是文字",
    blankMessage: "历史累计结算为零时必须填写依据"
  })
  zeroSettlementBasis?: string;
}

export class SaveContractTakeoverContractFactsDto {
  @IsUUID("4", { message: "合同侧保存幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "合同侧修订必须是整数",
    rangeMessage: "合同侧修订必须大于等于 0"
  })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "请按 YYYY-MM-DD 填写签订日期",
    typeMessage: "签订日期必须是文字",
    blankMessage: "请按 YYYY-MM-DD 填写签订日期"
  })
  @IsStrictDateOnly({ message: "签订日期必须按 YYYY-MM-DD 填写且日期必须有效" })
  signedAt!: string;

  @IsIn(["not_started", "performing", "suspended", "completed", "terminated"], {
    message: "历史合同履约状态不在系统支持范围内"
  })
  performanceStatus!: ContractTakeoverPerformanceStatus;

  @IsCanonicalMoneyText({
    typeMessage: "历史累计结算格式不正确",
    formatMessage: "历史累计结算必须按分填写为 0 或更大的整数"
  })
  historicalSettledCents!: string;

  @IsRequiredText({
    requiredMessage: "请填写历史结算依据说明",
    typeMessage: "历史结算依据说明必须是文字",
    blankMessage: "请填写历史结算依据说明"
  })
  settlementEvidenceSummary!: string;

  @IsArray({ message: "历史结算依据文件必须是数组" })
  @ArrayMinSize(1, { message: "请至少上传一份历史结算依据文件" })
  @ArrayMaxSize(50, { message: "历史结算依据文件最多上传 50 份" })
  @ArrayUnique({ message: "历史结算依据文件不能重复" })
  @IsString({ each: true, message: "历史结算依据文件标识必须是文字" })
  @Matches(/\S/u, {
    each: true,
    message: "历史结算依据文件标识不能为空白"
  })
  settlementEvidenceFileIds!: string[];

  @ValidateNested({ message: "历史付款条款必须是对象" })
  @Type(() => HistoricalPaymentTermsInput)
  paymentTerms!: HistoricalPaymentTermsInput;

  @ValidateNested({ message: "历史合同事实必须是对象" })
  @Type(() => HistoricalContractFactsInput)
  contractFacts!: HistoricalContractFactsInput;
}

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested
} from "class-validator";

import { IsMaxUnicodeTextLength, IsRequiredText } from "../validation/static-field-validation";
import { FUND_MOVEMENT_KINDS } from "./fund-movement.domain";

const FUND_MOVEMENT_DIRECTIONS = ["increase", "decrease", "neutral"] as const;

export class FundMovementLegDto {
  @IsIn(["source", "beneficiary"], { message: "资金移动分腿角色不正确" })
  role!: "source" | "beneficiary";

  @IsRequiredText({
    requiredMessage: "资金移动分腿项目不能为空",
    typeMessage: "资金移动分腿项目必须是文字",
    blankMessage: "资金移动分腿项目不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "资金移动分腿项目标识不能超过 128 个字符" })
  projectId!: string;

  @IsRequiredText({
    requiredMessage: "资金移动分腿公司不能为空",
    typeMessage: "资金移动分腿公司必须是文字",
    blankMessage: "资金移动分腿公司不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "资金移动分腿公司标识不能超过 128 个字符" })
  companyEntityId!: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "对手项目不能为空",
    typeMessage: "对手项目必须是文字",
    blankMessage: "对手项目不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "对手项目标识不能超过 128 个字符" })
  counterpartyProjectId?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "对手公司不能为空",
    typeMessage: "对手公司必须是文字",
    blankMessage: "对手公司不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "对手公司标识不能超过 128 个字符" })
  counterpartyCompanyEntityId?: string;

  @IsIn(FUND_MOVEMENT_DIRECTIONS, { message: "资金移动分腿方向不正确" })
  direction!: (typeof FUND_MOVEMENT_DIRECTIONS)[number];

  @Matches(/^[1-9]\d*$/u, { message: "资金移动分腿金额格式不正确" })
  amountCents!: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "资金移动来源类型不能为空",
    typeMessage: "资金移动来源类型必须是文字",
    blankMessage: "资金移动来源类型不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "资金移动来源类型不能超过 128 个字符" })
  sourceType?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "资金移动来源标识不能为空",
    typeMessage: "资金移动来源标识必须是文字",
    blankMessage: "资金移动来源标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "资金移动来源标识不能超过 128 个字符" })
  sourceAggregateId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "资金移动来源分摊数量必须是整数" })
  @Min(1, { message: "资金移动来源分摊数量必须大于零" })
  sourceAllocationCount?: number;

  @IsOptional()
  @Matches(/^[1-9]\d*$/u, { message: "资金移动来源分摊金额格式不正确" })
  sourceAllocationAmountCents?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "合同标识不能为空",
    typeMessage: "合同标识必须是文字",
    blankMessage: "合同标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "合同标识不能超过 128 个字符" })
  contractId?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "合同版本标识不能为空",
    typeMessage: "合同版本标识必须是文字",
    blankMessage: "合同版本标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "合同版本标识不能超过 128 个字符" })
  contractVersionId?: string;

  @IsObject({ message: "资金移动来源快照必须是对象" })
  sourceSnapshot!: Record<string, unknown>;
}

export class CreateFundMovementDto {
  @IsIn(FUND_MOVEMENT_KINDS, { message: "资金移动用途不在允许范围内" })
  kind!: (typeof FUND_MOVEMENT_KINDS)[number];

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "实际付款标识不能为空",
    typeMessage: "实际付款标识必须是文字",
    blankMessage: "实际付款标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "实际付款标识不能超过 128 个字符" })
  paymentExecutionId?: string;

  @IsRequiredText({
    requiredMessage: "来源项目不能为空",
    typeMessage: "来源项目必须是文字",
    blankMessage: "来源项目不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "来源项目标识不能超过 128 个字符" })
  sourceProjectId!: string;

  @IsRequiredText({
    requiredMessage: "受益项目不能为空",
    typeMessage: "受益项目必须是文字",
    blankMessage: "受益项目不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "受益项目标识不能超过 128 个字符" })
  beneficiaryProjectId!: string;

  @IsRequiredText({
    requiredMessage: "来源公司不能为空",
    typeMessage: "来源公司必须是文字",
    blankMessage: "来源公司不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "来源公司标识不能超过 128 个字符" })
  sourceCompanyEntityId!: string;

  @IsRequiredText({
    requiredMessage: "受益公司不能为空",
    typeMessage: "受益公司必须是文字",
    blankMessage: "受益公司不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "受益公司标识不能超过 128 个字符" })
  beneficiaryCompanyEntityId!: string;

  @Matches(/^[1-9]\d*$/u, { message: "资金移动金额格式不正确" })
  paymentAmountCents!: string;

  @Matches(/^\d+$/u, { message: "项目资金使用金额格式不正确" })
  projectFundUsedCents!: string;

  @Matches(/^\d+$/u, { message: "公司垫资金额格式不正确" })
  companyAdvanceCents!: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "利润授权标识不能为空",
    typeMessage: "利润授权标识必须是文字",
    blankMessage: "利润授权标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "利润授权标识不能超过 128 个字符" })
  profitAuthorizationId?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "被调整往来标识不能为空",
    typeMessage: "被调整往来标识必须是文字",
    blankMessage: "被调整往来标识不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "被调整往来标识不能超过 128 个字符" })
  adjustsRelationshipEntryId?: string;

  @IsArray({ message: "资金移动分腿必须是数组" })
  @ArrayMinSize(2, { message: "资金移动至少需要两条分腿" })
  @ArrayMaxSize(2, { message: "资金移动最多只能有两条分腿" })
  @ValidateNested({ each: true })
  @Type(() => FundMovementLegDto)
  legs!: FundMovementLegDto[];

  @IsString({ message: "幂等键必须是文字" })
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    { message: "资金移动幂等键必须是 UUIDv4" }
  )
  idempotencyKey!: string;
}

export class FundMovementCommandDto {
  @Type(() => Number)
  @IsInt({ message: "资金移动修订号必须是整数" })
  @Min(1, { message: "资金移动修订号必须大于零" })
  expectedRevision!: number;

  @IsString({ message: "幂等键必须是文字" })
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    { message: "资金移动幂等键必须是 UUIDv4" }
  )
  idempotencyKey!: string;
}

import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested
} from "class-validator";

const ROW_KINDS = ["payable", "payment_execution", "settlement_allocation", "inter_entity_relationship", "fund_movement", "opening_balance"] as const;
const EVIDENCE_LEVELS = ["A", "B", "C"] as const;
const OPENING_AXES = ["payable", "relationship", "fund"] as const;

export class HistoricalFinancialOpeningBalanceDto {
  @IsIn(OPENING_AXES)
  axis!: (typeof OPENING_AXES)[number];

  @IsString()
  subjectKey!: string;

  @IsString()
  counterpartyKey!: string;

  @IsString()
  categoryCode!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period!: string;

  @Matches(/^[1-9]\d*$/)
  grossAmountCents!: string;

  @IsString()
  evidenceReference!: string;
}

export class HistoricalFinancialTakeoverRowDto {
  @IsString()
  sourceType!: string;

  @IsString()
  sourceBusinessId!: string;

  @IsInt()
  @Min(1)
  sourceVersion!: number;

  @IsString()
  sourceCoordinate!: string;

  @Matches(/^[0-9a-f]{64}$/i)
  normalizedRowHash!: string;

  @IsIn(ROW_KINDS)
  kind!: (typeof ROW_KINDS)[number];

  @IsIn(EVIDENCE_LEVELS)
  evidenceLevel!: (typeof EVIDENCE_LEVELS)[number];

  @Matches(/^[1-9]\d*$/)
  amountCents!: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsString()
  targetRef?: string;

  @IsOptional()
  @IsString()
  gapReason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HistoricalFinancialOpeningBalanceDto)
  openingBalance?: HistoricalFinancialOpeningBalanceDto;

  @IsOptional()
  @IsUUID("4")
  legacyProjectProxyPaymentId?: string;

  @IsOptional()
  @IsUUID("4")
  legacyProjectAffiliatePaymentFactId?: string;
}

export class PrepareHistoricalFinancialTakeoverDto {
  @IsUUID("4")
  idempotencyKey!: string;

  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsDateString()
  asOfDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoricalFinancialTakeoverRowDto)
  rows!: HistoricalFinancialTakeoverRowDto[];
}

export class HistoricalFinancialTakeoverCommandDto {
  @IsUUID("4")
  idempotencyKey!: string;

  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @Matches(/^[0-9a-f]{64}$/)
  manifestFingerprint!: string;
}

export class CompensateHistoricalFinancialTakeoverDto extends HistoricalFinancialTakeoverCommandDto {
  @IsString()
  reason!: string;
}

export type HistoricalFinancialTakeoverRowInput = HistoricalFinancialTakeoverRowDto;

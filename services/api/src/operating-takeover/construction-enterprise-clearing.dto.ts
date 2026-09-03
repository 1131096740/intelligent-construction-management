import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  Matches,
  Min,
  ValidateNested
} from "class-validator";

export class CreateConstructionEnterpriseTakeoverRowDto {
  @IsIn(["assigned_wage", "guarantee"])
  kind!: "assigned_wage" | "guarantee";

  @IsString()
  selectionRef!: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "工资月份必须是 YYYY-MM" })
  period?: string;

  @IsOptional()
  @Matches(/^[1-9]\d*$/, { message: "保证金 tranche 金额必须是正整数分字符串" })
  @IsString()
  amountCents?: string;

  @IsString()
  @MinLength(1)
  businessReason!: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;
}

export class CreateConstructionEnterpriseTakeoverManifestDto {
  @IsUUID("4")
  idempotencyKey!: string;

  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsUUID("4")
  delegatorUserId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateConstructionEnterpriseTakeoverRowDto)
  rows!: CreateConstructionEnterpriseTakeoverRowDto[];
}

export class ConstructionEnterpriseTakeoverCommandDto {
  @IsUUID("4")
  idempotencyKey!: string;

  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsUUID("4")
  delegatorUserId?: string;
}

export class CompensateConstructionEnterpriseTakeoverDto extends ConstructionEnterpriseTakeoverCommandDto {
  @IsUUID("4")
  activationReceiptId!: string;
}

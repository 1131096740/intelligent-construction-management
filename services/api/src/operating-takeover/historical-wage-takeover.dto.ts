import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

/**
 * Deliberately narrow external contract: all identity, company, project,
 * month, amount, source discriminator, evidence hash and closure are inside
 * the server-issued short-lived selectionRef, never in this DTO.
 */
export class HistoricalWageTakeoverCommandDto {
  @IsString()
  @MinLength(1)
  selectionRef!: string;

  @IsUUID("4")
  idempotencyKey!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsString()
  @MinLength(1)
  businessReason!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceRefs?: string[];

  @IsOptional()
  @IsUUID("4")
  delegatorUserId?: string;
}

/**
 * Reissues a server-held scope token to a separately authorized effective
 * identity. It intentionally has no project, person, month, amount, source,
 * or evidence fields.
 */
export class HistoricalWageTakeoverSelectionRenewalDto {
  @IsString()
  @MinLength(1)
  selectionRef!: string;

  @IsOptional()
  @IsUUID("4")
  delegatorUserId?: string;
}

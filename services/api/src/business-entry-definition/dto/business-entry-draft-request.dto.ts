import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from "class-validator";
import { BUSINESS_ENTRY_OPERATIONS } from "@jiangkong/shared-domain";

class BusinessEntrySubmissionTargetDto {
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @IsString()
  @IsNotEmpty()
  entityId!: string;
}

export class BusinessEntryDraftRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  definitionVersion?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessEntrySubmissionTargetDto)
  target?: BusinessEntrySubmissionTargetDto;

  @IsObject()
  values!: Record<string, unknown>;

  @IsOptional()
  @IsIn(BUSINESS_ENTRY_OPERATIONS)
  operation?: (typeof BUSINESS_ENTRY_OPERATIONS)[number];
}

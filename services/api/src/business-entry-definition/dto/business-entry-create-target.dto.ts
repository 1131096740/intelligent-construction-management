import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class BusinessEntryCreateTargetDto {
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @IsOptional()
  @IsUUID("4")
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fingerprint?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  definitionKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  definitionVersion?: number;
}

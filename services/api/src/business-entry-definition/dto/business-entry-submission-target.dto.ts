import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from "class-validator";

export class BusinessEntrySubmissionTargetDto {
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @IsString()
  @IsNotEmpty()
  probe!: string;

  @IsUUID("4")
  idempotencyKey!: string;

  @IsString()
  @IsNotEmpty()
  fingerprint!: string;

  @IsString()
  @IsNotEmpty()
  definitionKey!: string;

  @IsInt()
  @Min(1)
  definitionVersion!: number;
}

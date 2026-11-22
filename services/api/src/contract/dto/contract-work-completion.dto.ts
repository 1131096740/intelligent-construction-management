import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateContractWorkCompletionDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  work!: string;

  @IsString()
  @MaxLength(25)
  amountYuan!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  requestKey!: string;
}

export class ReviseContractWorkCompletionDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  work!: string;

  @IsString()
  @MaxLength(25)
  amountYuan!: string;
}

export class ReviewContractWorkCompletionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  approvalInstanceId!: string;

  @IsInt()
  @Min(0)
  @Max(2)
  dutyIndex!: number;

  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  selfReviewReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  confirmationPassword?: string;
}

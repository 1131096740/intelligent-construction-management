import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested
} from "class-validator";

export class ProjectCloseStageBasisDto {
  @IsString()
  @Length(1, 500)
  summary!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID("4", { each: true })
  evidenceFileIds!: string[];
}

export class CompleteProjectCloseStageDto {
  @IsString()
  @Length(1, 128)
  expectedProjectionFingerprint!: string;

  @IsUUID("4")
  idempotencyKey!: string;

  @ValidateNested()
  @Type(() => ProjectCloseStageBasisDto)
  basis!: ProjectCloseStageBasisDto;
}

export class AttestDownstreamCostDto extends CompleteProjectCloseStageDto {}

export class SubmitFinalProfitDto extends CompleteProjectCloseStageDto {}

export class ConfirmProjectCloseDecisionDto {
  @IsString()
  @Length(1, 128)
  expectedProjectionFingerprint!: string;

  @IsUUID("4")
  idempotencyKey!: string;

  @IsUUID("4")
  submissionId!: string;
}

export class ConfirmFinalProfitDto extends ConfirmProjectCloseDecisionDto {}

export class CreateTemporaryProfitDistributionDto extends CompleteProjectCloseStageDto {
  @IsString()
  @Length(1, 128)
  projectParticipatingCompanyId!: string;

  @IsString()
  @Matches(/^[1-9][0-9]*$/u)
  amountCents!: string;
}

export class ReconcileProjectCloseImpactsDto extends CompleteProjectCloseStageDto {}

export class ProjectCloseDistributionLineDto {
  @IsString()
  @Length(1, 128)
  projectParticipatingCompanyId!: string;

  @IsString()
  @Matches(/^-?(0|[1-9][0-9]*)$/u)
  finalShareCents!: string;
}

export class SubmitProjectCloseDistributionDto extends CompleteProjectCloseStageDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProjectCloseDistributionLineDto)
  lines!: ProjectCloseDistributionLineDto[];
}

export class ConfirmProjectCloseDistributionDto extends ConfirmProjectCloseDecisionDto {}

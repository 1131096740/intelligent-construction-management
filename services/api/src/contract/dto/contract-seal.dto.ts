import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Matches, Min } from "class-validator";

export class ApproveContractSealDto {
  @IsString()
  @IsNotEmpty()
  confirmationPassword!: string;
}

export class CompleteContractSealDto {
  @IsBoolean()
  firstPartySignedOrStamped!: boolean;

  @IsBoolean()
  companySealCompleted!: boolean;

  @IsBoolean()
  crossPageSealCompleted!: boolean;

  @IsBoolean()
  signingDateCompleted!: boolean;
}

export class UploadMutuallySignedContractDto extends CompleteContractSealDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceRevision!: number;

  @IsBoolean()
  onlyPermittedSignatureChanges!: boolean;

  @IsBoolean()
  documentOrderConfirmed!: boolean;
}

export class ConfirmMutuallySignedContractDto extends CompleteContractSealDto {
  @IsString()
  @IsNotEmpty()
  formalFileId!: string;

  @IsBoolean()
  onlyPermittedSignatureChanges!: boolean;

  @IsBoolean()
  documentOrderConfirmed!: boolean;

  @IsString()
  @IsNotEmpty()
  confirmationPassword!: string;
}

export class ReturnContractFormalFileDto {
  @IsString()
  @IsNotEmpty()
  formalFileId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/u, { message: "补正原因不能为空白" })
  reason!: string;
}

export class InvalidateContractSigningDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsString()
  @IsNotEmpty()
  expectedSealTaskId!: string;

  @IsString()
  @IsIn([
    "approved_pending_seal",
    "in_seal",
    "seal_approved_pending_archive",
    "pending_archive_confirm"
  ])
  expectedStatus!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/u, { message: "实质变化原因不能为空白" })
  reason!: string;
}

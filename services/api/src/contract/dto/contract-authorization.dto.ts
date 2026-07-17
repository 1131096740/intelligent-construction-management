import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export class ContractAuthorizationUploadDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  grantorName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  agentName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  scopeSummary!: string;
}

export class ContractAuthorizationReuseDto {
  @IsString()
  @IsNotEmpty()
  authorizationId!: string;

  @IsString()
  @IsNotEmpty()
  sourceContractVersionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  agentName!: string;
}

export class SetContractAuthorizationDto {
  @IsIn(["first_party", "counterparty"])
  side!: "first_party" | "counterparty";

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContractAuthorizationUploadDto)
  upload?: ContractAuthorizationUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContractAuthorizationReuseDto)
  reuse?: ContractAuthorizationReuseDto;
}

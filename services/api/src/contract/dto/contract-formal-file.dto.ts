import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsNotEmpty, IsString, Min } from "class-validator";

export class UploadContractFormalFileDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceRevision!: number;

  @IsBoolean()
  counterpartySigned!: boolean;

  @IsBoolean()
  counterpartyStamped!: boolean;

  @IsBoolean()
  crossPageSealCompleted!: boolean;

  @IsBoolean()
  documentOrderConfirmed!: boolean;

  @IsBoolean()
  authorizationsBeforeSignaturePageConfirmed!: boolean;
}

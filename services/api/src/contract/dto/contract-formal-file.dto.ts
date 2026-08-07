import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Min
} from "class-validator";

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

// 乙方签章灵活格式文件：一次上传同类型的原始文件（PDF / DOCX / 多张图片），
// 后端生成规范化预览后，由合同经办人对预览做整体确认。
export class UploadCounterpartySignedFileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  fileIds!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceRevision!: number;
}

export class ConfirmCounterpartySignedFileDto {
  @IsString()
  @IsNotEmpty()
  formalFileId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedDraftRevision!: number;
}

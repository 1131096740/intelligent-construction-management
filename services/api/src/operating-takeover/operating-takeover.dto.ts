import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested
} from "class-validator";
import { EVIDENCE_LEVELS, OPERATING_TAKEOVER_PROFESSIONS } from "@jiangkong/shared-domain";

class OperatingTakeoverRowInputDto {
  @IsOptional()
  @IsString()
  sceneKey?: string;

  @IsOptional()
  @IsInt({ message: "字段定义版本必须是整数" })
  @Min(1, { message: "字段定义版本无效" })
  definitionVersion?: number;

  @IsObject({ message: "接管行必须是业务字段对象" })
  values!: Record<string, unknown>;
}

export class PrecheckOperatingTakeoverDto {
  @IsOptional()
  @IsString()
  sceneKey?: string;

  @IsArray({ message: "接管行必须是数组" })
  @ValidateNested({ each: true })
  @Type(() => OperatingTakeoverRowInputDto)
  rows!: OperatingTakeoverRowInputDto[];
}

export class CreateOperatingTakeoverBatchDto extends PrecheckOperatingTakeoverDto {
  @IsOptional()
  @IsString()
  batchNo?: string;

  @IsOptional()
  @IsUUID("4", { message: "来源文件编号必须是 UUID" })
  sourceFileId?: string;
}

export class UpdateOperatingTakeoverRowDto {
  @IsInt({ message: "草稿版本必须是整数" })
  @Min(1, { message: "草稿版本无效" })
  expectedRevision!: number;

  @IsObject({ message: "接管行必须是业务字段对象" })
  values!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  duplicateNote?: string;

  @IsOptional()
  @IsString()
  reviewConclusion?: string;
}

export class ConfirmOperatingTakeoverDto {
  @IsIn(OPERATING_TAKEOVER_PROFESSIONS, { message: "确认专业不正确" })
  profession!: (typeof OPERATING_TAKEOVER_PROFESSIONS)[number];

  @IsInt({ message: "确认版本必须是整数" })
  @Min(1, { message: "确认版本无效" })
  expectedRevision!: number;

  @IsUUID("4", { message: "确认幂等键必须是 UUID" })
  idempotencyKey!: string;
}

export class ActivateOperatingTakeoverDto {
  @IsUUID("4", { message: "激活幂等键必须是 UUID" })
  idempotencyKey!: string;
}

export class AddOperatingTakeoverAttachmentGroupDto {
  @IsString()
  purpose!: string;

  @IsOptional()
  @IsUUID("4", { message: "行编号必须是 UUID" })
  rowId?: string;

  @IsArray()
  @IsUUID("4", { each: true, message: "附件编号必须是 UUID" })
  fileIds!: string[];
}

export const operatingTakeoverEvidenceLevels = EVIDENCE_LEVELS;

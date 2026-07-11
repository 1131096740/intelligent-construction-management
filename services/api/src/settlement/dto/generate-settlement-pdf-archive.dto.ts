import { IsString, ValidateIf } from "class-validator";

export class GenerateSettlementPdfArchiveDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "模板标识必须是文字" })
  templateKey?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "归档部门范围必须是文字" })
  departmentScope?: string;
}

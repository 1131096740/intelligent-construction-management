import { IsOptional, IsString, ValidateIf } from "class-validator";

export class ListConstructionEnterprisePaidDto {
  @IsOptional()
  @IsString({ message: "施工企业已付明细游标必须是文字" })
  cursor?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业已付明细每页条数必须是文字" })
  pageSize?: string;
}

import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";

export class BusinessEntryExcelPreviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  definitionVersion!: number;

  @IsString()
  @IsNotEmpty()
  targetEntityType!: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  targetEntityId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  targetCreateTarget?: string;
}
